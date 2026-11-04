import { listContainersWithRuntime, type RuntimeContainer } from "@/lib/docker";
import { getSmartSnapshot } from "@/lib/smart";
import { getHostVitals, HOST_ROOTFS, HOST_SYS, readHostMounts } from "@/lib/host-metrics";
import { queryMountHistory } from "@/lib/metrics-history";
import { formatUptime, relativeTime } from "@/lib/format";
import { readBackupStatus } from "@/lib/backup-status-read";
import { backupHeadline, summarizeBackup, type BackupStatus } from "@/lib/backup-status";
import {
  firstHit,
  PENDING,
  parseSince,
  runProbes,
  sortHits,
  toHits,
  deriveChanges,
  clipError,
  type AttentionHit,
  type AttentionReport,
  type ProbeDef,
  type RawHit,
} from "@/lib/attention-report";
import {
  backupCheckStopped,
  backupDetail,
  containerCrashed,
  containerDown,
  containerUnhealthy,
  diskFull,
  driveAlert,
  driveUnreadable,
  integrityAlert,
  keepsRestarting,
  stuckRestarting,
  type AlertCopy,
} from "@/lib/attention-copy";
import { Memo } from "@/lib/cache";
import { getOrchestraDetail, getOrchestraSnapshot } from "@/lib/orchestra";
import { isLive, orchestraAttention } from "@/lib/orchestra-view";
import type { OrchestratorDetail } from "@/lib/types/orchestra";
import { blockDeviceName, classifyDeviceGone, classifyMountError, probeOne, type MountVerdict } from "@/lib/mount-probe";
import fs, { promises as fsp } from "node:fs";
import path from "node:path";
import type { HealthVerdict } from "@/lib/types/smart";

/**
 * "One Thing Needs You" — the kiosk's alert-by-exception evaluator.
 *
 * Silence is the feature: a healthy homelab shows nothing here, so the bar to
 * speak is high. getAttention() checks a short list of REAL deviations in
 * priority order and returns the first one it finds — never a summary of
 * everything that's slightly off. Every probe below is run by runProbes
 * (attention-report.ts): a broken probe (a Docker hiccup, a missing
 * smart.json, an unreadable history file) is reported as a failed probe,
 * never as "found nothing", and never as a fabricated alert or a 500. The
 * kiosk still gets only the first hit; Home gets the whole report. Reuses the same
 * server-side libs the rest of the dashboard already reads from — no
 * shelling out, no re-implemented fetching.
 */

export type AttentionSeverity = "warn" | "bad";

export type AttentionResult =
  | { status: "quiet" }
  | {
      status: "attention";
      severity: AttentionSeverity;
      /** Plain English, ≤48 chars. May name the container/drive — this is a
       *  deliberately owner-facing surface (see the route's own comment). */
      headline: string;
      /** ≤140 chars. Supporting context, never required to make sense of the headline. */
      detail?: string;
      /** ≤70 chars. The one next step, or what to ignore. */
      action?: string;
      /** ISO timestamp of when the condition started, when known. */
      since?: string;
    };

const CACHE_TTL_MS = 30_000;
const HEADLINE_MAX = 48;
const DETAIL_MAX = 140;
const ACTION_MAX = 70;
/** Same floor disk-growth.tsx uses before it trusts a first-vs-last delta as a
 *  real trend rather than noise — a window under a day is too short to call
 *  honestly, so a projection is skipped (never faked) below that. */
const THIN_HISTORY_MS = 24 * 60 * 60 * 1000;
const DISK_WARN_PCT = 85;
const GROWTH_HORIZON_DAYS = 30;

const globalForAttention = globalThis as unknown as {
  __attentionRestartCounts?: Map<string, number>;
  __attentionDriveVerdicts?: Map<string, HealthVerdict>;
};

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function hit(subject: string, severity: AttentionSeverity, copy: AlertCopy, since?: string): RawHit {
  return {
    subject,
    severity,
    headline: clip(copy.headline, HEADLINE_MAX),
    detail: copy.detail ? clip(copy.detail, DETAIL_MAX) : undefined,
    action: copy.action ? clip(copy.action, ACTION_MAX) : undefined,
    since,
  };
}

// --- (a) a container that has died or crashed ------------------------------

/**
 * ContainerSummary/RuntimeContainer carry no restart-policy field — docker.ts's
 * containerRuntimes() inspects start/finish timestamps and restart count only,
 * not HostConfig.RestartPolicy — so "should run" is approximated rather than
 * read from policy. `dead` is unambiguous. An `exited` container counts as
 * "should have kept running" only when it actually ran before (startedAt is
 * set, ruling out a container that was created but never started) AND its
 * exit code is non-zero. This is an honest approximation with two known
 * failure directions: it under-reports a container left cleanly "exited (0)"
 * whose restart policy was e.g. on-failure, and it can over-report an
 * intentional `docker stop` that ran past the 15s SIGTERM grace period this
 * app's own stop action grants (see containerAction() in docker.ts) and got
 * SIGKILLed into a non-zero exit code.
 */
function probeContainerDeath(containers: RuntimeContainer[]): RawHit[] {
  const dead = containers
    .filter((c) => c.state === "dead")
    .map((c) => {
      const upSecs = c.startedAt != null && c.finishedAt != null ? (c.finishedAt - c.startedAt) / 1000 : null;
      return hit(
        `container:${c.name}`,
        "bad",
        containerDown(c.name, upSecs != null ? formatUptime(upSecs) : null),
        c.finishedAt != null ? new Date(c.finishedAt).toISOString() : undefined,
      );
    });

  const crashed = containers
    .filter((c) => c.state === "exited" && c.startedAt != null && c.exitCode != null && c.exitCode !== 0)
    .map((c) =>
      hit(
        `container:${c.name}`,
        "bad",
        containerCrashed(c.name, c.exitCode!),
        c.finishedAt != null ? new Date(c.finishedAt).toISOString() : undefined,
      ),
    );

  return [...dead, ...crashed];
}

// --- (b) restart-looping ----------------------------------------------------

/**
 * No restart-count history is plumbed anywhere — metrics-history.ts samples
 * cpu/mem/net only — so "climbing" is approximated by comparing this call's
 * restartCount against the value this same module recorded on its OWN last
 * run, kept in a globalThis map with the same process lifetime as the 30s
 * result cache below. A container that stops restarting stops matching
 * within one or two probe cycles, since the baseline advances every call.
 * The live `restarting` state is trusted directly and needs no history at all.
 */
function probeRestartLoop(containers: RuntimeContainer[]): RawHit[] {
  const counts = globalForAttention.__attentionRestartCounts ?? new Map<string, number>();
  globalForAttention.__attentionRestartCounts = counts;

  const hits: RawHit[] = [];
  for (const c of containers) {
    const prev = counts.get(c.id);
    if (c.state === "restarting") {
      hits.push(hit(`container:${c.name}`, "bad", stuckRestarting(c.name, c.restartCount)));
    } else if (prev != null && c.restartCount > prev) {
      hits.push(hit(`container:${c.name}`, "bad", keepsRestarting(c.name, c.restartCount - prev, c.restartCount)));
    }
    // Advance the baseline every call, win or not — the whole point is a
    // rolling "since last check" delta, not a fixed reference point.
    counts.set(c.id, c.restartCount);
  }
  return hits;
}

// --- (c) SMART / array integrity --------------------------------------------

/**
 * Two conditions, exactly as specified: a drive whose own verdict is "bad"
 * (SMART failed, media errors, a pre-fail attribute at threshold, ...) is
 * always worth a card. A drive that reads "unknown" is NOT automatically
 * alarming — plenty of drives (USB bridges, sleeping disks) are unknown by
 * design and always have been — so "unknown" only speaks when this module
 * previously recorded that SAME drive as "ok" or "warn", i.e. SMART data
 * that used to be readable just stopped being readable. That transition is
 * tracked the same way restart deltas are: a globalThis map this module owns.
 * Ordinary "warn" drive verdicts (elevated wear, a temperature approaching
 * its threshold) are deliberately NOT surfaced here — they're gentle,
 * already visible on the real dashboard, and would erode the silence this
 * card depends on to mean something. RAID/pool/filesystem integrity failures
 * ride the same probe since they come off the same getSmartSnapshot() call.
 */
async function probeSmart(isLate: () => boolean): Promise<RawHit[]> {
  const snapshot = await getSmartSnapshot();

  const hits: RawHit[] = [];
  if (snapshot.integrity.verdict === "bad") {
    hits.push(hit("array", "bad", integrityAlert(snapshot.integrity.reasons)));
  }

  const verdicts = globalForAttention.__attentionDriveVerdicts ?? new Map<string, HealthVerdict>();
  globalForAttention.__attentionDriveVerdicts = verdicts;

  for (const drive of snapshot.drives) {
    if (drive.verdict === "bad") {
      hits.push(hit(`drive:${drive.device}`, "bad", driveAlert(drive.name, drive.reasons)));
    } else if (drive.verdict === "unknown") {
      const prev = verdicts.get(drive.device);
      if (prev === "ok" || prev === "warn") hits.push(hit(`drive:${drive.device}`, "warn", driveUnreadable(drive.name)));
    }
  }
  // A late probe is dropped by the report, so its baseline must not advance or the hit is lost for good.
  if (!isLate()) for (const drive of snapshot.drives) verdicts.set(drive.device, drive.verdict);
  return hits;
}

// --- (c2) a mount that cannot be read ---------------------------------------

const MOUNT_READ_TIMEOUT_MS = 3_000;

/**
 * Is the mount's block device still on the bus? Reads the host sysfs bind
 * (HOST_SYS, as host-metrics.ts does). No host sysfs (dev mode), an alias
 * source or an unreadable node = null, never a false alarm.
 */
function deviceGone(mount: string, device: string | undefined): MountVerdict | null {
  const name = blockDeviceName(device);
  if (!name || !fs.existsSync(`${HOST_SYS}/class/block`)) return null;
  const node = `${HOST_SYS}/class/block/${name}`;
  if (!fs.existsSync(node)) return classifyDeviceGone(mount, name, false, null);
  let real: string;
  try {
    real = fs.realpathSync(node);
  } catch {
    return null;
  }
  // A partition's sysfs dir sits inside its disk's dir; the disk owns device/state.
  const disk = fs.existsSync(`${real}/partition`) ? path.dirname(real) : real;
  let state: string | null = null;
  try {
    state = fs.readFileSync(`${disk}/device/state`, "utf8");
  } catch {
    // no state file (virtio, md, ...): nothing to say
  }
  return classifyDeviceGone(mount, name, true, state);
}

/**
 * 2026-10-09: the media drive dropped off SATA and the mount stayed on the dead
 * device, so every read hit EIO while `df` looked normal for ~20 hours. Two
 * checks per mount, all mounts in parallel: is its block device still in host
 * sysfs, and does a readdir of its root (via the host rootfs bind, like
 * disk-usage.ts) answer within 3s. The root readdir can be served from cache,
 * so it only catches mounts that error or hang; the sysfs check covers the
 * drive that left the bus. probeOne never starts a second readdir on a mount
 * whose first is still stuck.
 */
async function probeMountReadable(): Promise<RawHit[]> {
  const vitals = await getHostVitals();
  const mounts = [...new Set(vitals.disk.flatMap((g) => g.mounts ?? [g.mount]))];
  const devices = new Map((readHostMounts() ?? []).map((m) => [m.mountpoint, m.device]));
  const verdicts = await Promise.all(
    mounts.map(async (mount) => {
      const gone = deviceGone(mount, devices.get(mount));
      if (gone) return gone;
      const target = mount === "/" ? HOST_ROOTFS : `${HOST_ROOTFS}${mount}`;
      return classifyMountError(mount, await probeOne(target, () => fsp.readdir(target), MOUNT_READ_TIMEOUT_MS));
    }),
  );
  return verdicts.flatMap((v, i) => (v ? [hit(`mount:${mounts[i]}`, "bad", v)] : []));
}

// --- (d) disk / volume capacity ---------------------------------------------

/**
 * Mirrors the "fastest growing" math disk-growth.tsx already does client-side
 * (first-vs-last real sample, requiring >=24h of recorded history before it's
 * trusted) rather than inventing a second formula — same THIN_HISTORY_MS
 * floor, same "need at least 2 real points" gate. Returns null (no opinion)
 * whenever the data doesn't support an honest projection, including a mount
 * that's shrinking or flat (nothing to project toward "full").
 */
async function estimateDaysToFull(mount: string, remainingBytes: number): Promise<number | null> {
  const { recordingSince, mounts } = await queryMountHistory("14d", [mount]);
  if (recordingSince == null || Date.now() - recordingSince < THIN_HISTORY_MS) return null;

  const points = (mounts[mount] ?? []).filter(
    (p): p is { t: number; usedBytes: number } => p.usedBytes != null,
  );
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const deltaDays = Math.max(1 / 24, (last.t - first.t) / 86_400_000);
  const deltaPerDay = (last.usedBytes - first.usedBytes) / deltaDays;
  if (deltaPerDay <= 0) return null;

  return remainingBytes / deltaPerDay;
}

/**
 * Fires on either an absolute >85% used, or (independently) a mount still
 * under that line but on track to cross 100% within ~30 days at its current
 * growth rate. When a growth estimate is available it rides along as extra
 * context even on the >85% branch — same combined shape the design brief's
 * own example uses ("docker pool 87% — ~24 days at current growth").
 */
async function probeDiskCapacity(): Promise<RawHit[]> {
  const vitals = await getHostVitals();
  const hits: RawHit[] = [];

  for (const group of vitals.disk) {
    const percent = Math.round(group.percent);
    const remaining = Math.max(0, group.total - group.used);

    let daysToFull: number | null = null;
    try {
      daysToFull = await estimateDaysToFull(group.mount, remaining);
    } catch {
      daysToFull = null; // history unreadable — this mount just loses the trend context, not the whole probe
    }

    // The trend branch also requires the disk to already be ≥75% full: a
    // half-empty disk "trending full in 30 days" is a projection artifact
    // (one heavy day skews the 24h delta — observed live when a build-storm
    // spike kept this firing at 70% right after 24GB was reclaimed), not a
    // thing that needs a wall alert. Absolute >85% fires regardless.
    const trendingFull = daysToFull != null && daysToFull <= GROWTH_HORIZON_DAYS && percent >= 75;
    if (percent > DISK_WARN_PCT || trendingFull) {
      const days = daysToFull != null ? Math.max(1, Math.round(daysToFull)) : null;
      hits.push(hit(`disk:${group.mount}`, "warn", diskFull(group.mount, percent, days)));
    }
  }

  return hits;
}

// --- (d2) ODIP backup ---------------------------------------------------------

/**
 * Same rules as the Overview tile (summarizeBackup): a FAILED item is "bad", a
 * STALE item, a missing kind or a check that has stopped running is "warn". A
 * missing or unreadable status file throws, so the report shows the backup
 * probe as failed rather than quiet; the kiosk still says nothing for it.
 */
function probeBackup(status: BackupStatus | null, readError: unknown): RawHit[] {
  if (!status) throw readError;
  if (status.status === "missing") throw new Error("the backup status file is missing");
  if (status.status === "unreadable") throw new Error(`the backup status file is unreadable: ${status.reason}`);

  const summary = summarizeBackup(status, Date.now());
  if (summary.worst === "OK") return [];

  const item = summary.items.find((i) => i.state === summary.worst)!;
  const copy = { headline: backupHeadline(summary), ...backupDetail(summary.worst, item.at ? relativeTime(item.at) : null) };
  if (summary.worst === "FAILED") return [hit("backup", "bad", copy, item.at ?? undefined)];
  if (summary.checkStale) return [hit("backup", "warn", backupCheckStopped(relativeTime(status.checkedAt)), status.checkedAt)];
  return [hit("backup", "warn", copy, item.at ?? undefined)];
}

// --- (e) failing healthcheck -------------------------------------------------

function probeUnhealthy(containers: RuntimeContainer[]): RawHit[] {
  return containers
    .filter((c) => c.health === "unhealthy")
    .map((c) => hit(`container:${c.name}`, "warn", containerUnhealthy(c.name)));
}

// --- (f) a stalled agent or an unanswering orchestra service ----------------

const ORCHESTRA_RACE_MS = 3_000;
/** Live in-flight agents (isLive) at the last good reading; 0 until the first one. Process lifetime, like the memos. */
let orchestraLastInFlight = 0;

/**
 * The list call carries counts only; quietMin lives on each orchestrator's
 * detail, so every orchestrator with work in flight is fetched in parallel and
 * isStalled (orchestra-view.ts) decides, not the service's own stalledCount.
 * A detail that comes back unreachable/unauthorized counts as that status.
 */
const orchestraMemo = new Memo<{ hits: RawHit[] }>({
  key: "attention.orchestra",
  ttlMs: CACHE_TTL_MS,
  load: async () => {
    const snap = await getOrchestraSnapshot();
    let status = snap.status;
    const details: OrchestratorDetail[] = [];
    if (status === "ok") {
      const busy = snap.orchestrators.filter((o) => o.inFlightCount > 0);
      for (const r of await Promise.all(busy.map((o) => getOrchestraDetail(o.name)))) {
        if (r.status !== "ok") status = r.status;
        else if (r.orchestrator) details.push(r.orchestrator);
      }
    }
    // No busy orchestrators means no details, so an ok reading with nothing in flight resets this to 0.
    if (status === "ok") orchestraLastInFlight = details.flatMap((o) => o.inFlight).filter((e) => isLive(e.quietMin)).length;
    const item = orchestraAttention(status, details, orchestraLastInFlight);
    return { hits: item ? [hit("orchestra", "warn", item)] : [] };
  },
});

/**
 * The client waits up to 5s, and a PC that is off often hangs that long. On a
 * 3s timeout this returns the last decision instead; the losing load keeps
 * running and fills the memo, so "stopped answering" shows one cycle late
 * rather than never.
 */
async function probeOrchestra(): Promise<RawHit[] | typeof PENDING> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ hits: RawHit[] } | null>((resolve) => {
    timer = setTimeout(() => resolve(orchestraMemo.peek()), ORCHESTRA_RACE_MS);
  });
  try {
    // A null peek means the memo has never settled: pending, not "no hit".
    const last = await Promise.race([orchestraMemo.get(), timeout]);
    return last ? last.hits : PENDING;
  } finally {
    clearTimeout(timer);
  }
}

// --- orchestration -----------------------------------------------------------

/** Slightly past ORCHESTRA_RACE_MS, so the orchestra's own race (which falls back to its last decision) settles first. */
const PROBE_DEADLINE_MS = ORCHESTRA_RACE_MS + 250;

const globalForSeen = globalThis as unknown as { __attentionFirstSeen?: Map<string, string> };

interface Computed {
  /** Everything but `changes`, which depends on the request's `since`. */
  report: Omit<AttentionReport, "changes">;
  /** Hits in probe order: the kiosk's firstHit reads this, report.hits is sorted. */
  ordered: AttentionHit[];
  containers: RuntimeContainer[];
  backup: BackupStatus | null;
  dockerError: string | null;
}

async function computeReport(): Promise<Computed> {
  // Fetched once and shared by every container-based probe below. If Docker
  // is unreachable those probes fail with its error, so a dead socket is
  // never read as "no crashes".
  let containers: RuntimeContainer[] = [];
  let dockerFailure: unknown = null;
  try {
    containers = await listContainersWithRuntime();
  } catch (e) {
    dockerFailure = e;
  }
  const needDocker = () => {
    if (dockerFailure) throw dockerFailure;
  };

  let backup: BackupStatus | null = null;
  let backupFailure: unknown = null;
  try {
    backup = await readBackupStatus();
  } catch (e) {
    backupFailure = e;
  }

  const defs: ProbeDef[] = [
    { id: "crashes", label: "Crashed apps", run: () => (needDocker(), probeContainerDeath(containers)) },
    { id: "restarts", label: "Restart loops", run: () => (needDocker(), probeRestartLoop(containers)) },
    { id: "smart", label: "Drive health", run: (isLate) => probeSmart(isLate) },
    { id: "mounts", label: "Mounts", run: () => probeMountReadable() },
    // After hardware: a dead drive outranks a late backup; before disk capacity,
    // because an unrecoverable database is worse than a filling one.
    { id: "backup", label: "Backup", run: () => probeBackup(backup, backupFailure) },
    { id: "disks", label: "Disk space", run: () => probeDiskCapacity() },
    { id: "health", label: "Health checks", run: () => (needDocker(), probeUnhealthy(containers)) },
    // Last: a quiet agent is never a household outage.
    { id: "orchestra", label: "AI lanes", run: () => probeOrchestra() },
  ];
  const outcomes = await runProbes(defs, PROBE_DEADLINE_MS);

  const seen = globalForSeen.__attentionFirstSeen ?? new Map<string, string>();
  globalForSeen.__attentionFirstSeen = seen;
  const now = new Date().toISOString();
  const ordered = toHits(outcomes, (id) => {
    if (!seen.has(id)) seen.set(id, now);
    return seen.get(id)!;
  });
  // shortcut: resets on restart, fine while the process is long-lived. Ids of probes that did not answer are kept.
  const current = new Set(ordered.map((h) => h.id));
  const answered = new Set(outcomes.filter((o) => o.status.state === "answered").map((o) => o.status.id));
  for (const id of seen.keys()) if (answered.has(id.split(":")[0] as never) && !current.has(id)) seen.delete(id);

  return {
    report: { checkedAt: now, probes: outcomes.map((o) => o.status), hits: sortHits(ordered) },
    ordered,
    containers,
    backup,
    dockerError: dockerFailure ? clipError(dockerFailure) : null,
  };
}

/** Module-level 30s cache shared by the kiosk and Home: the restart and drive
 *  baselines advance on every compute, so both surfaces must read one run. */
const reportMemo = new Memo<Computed>({
  key: "attention.report",
  ttlMs: CACHE_TTL_MS,
  load: computeReport,
});

export async function getAttentionReport(sinceRaw: string | null): Promise<AttentionReport> {
  const c = await reportMemo.get();
  const sinceMs = parseSince(sinceRaw, Date.now());
  const events = deriveChanges(c.containers, c.backup, sinceMs, c.ordered.map((h) => h.subject));
  const changes = c.dockerError
    ? { since: new Date(sinceMs).toISOString(), status: "failed" as const, error: c.dockerError, events }
    : { since: new Date(sinceMs).toISOString(), status: "answered" as const, events };
  return { ...c.report, changes };
}

export async function getAttention(): Promise<AttentionResult> {
  return firstHit((await reportMemo.get()).ordered);
}
