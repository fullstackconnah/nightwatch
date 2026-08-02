import { listContainersWithRuntime, type RuntimeContainer } from "@/lib/docker";
import { getSmartSnapshot } from "@/lib/smart";
import { getHostVitals } from "@/lib/host-metrics";
import { queryMountHistory } from "@/lib/metrics-history";
import { formatUptime } from "@/lib/format";
import type { HealthVerdict } from "@/lib/smart-types";

/**
 * "One Thing Needs You" — the kiosk's alert-by-exception evaluator.
 *
 * Silence is the feature: a healthy homelab shows nothing here, so the bar to
 * speak is high. getAttention() checks a short list of REAL deviations in
 * priority order and returns the first one it finds — never a summary of
 * everything that's slightly off. Every probe below is independently
 * try/caught by the caller: a broken probe (a Docker hiccup, a missing
 * smart.json, an unreadable history file) must degrade to "this probe found
 * nothing" and never to a fabricated alert or a 500. Reuses the same
 * server-side libs the rest of the dashboard already reads from — no
 * shelling out, no re-implemented fetching.
 */

export type AttentionSeverity = "warn" | "bad";

export type AttentionResult =
  | { status: "quiet" }
  | {
      status: "attention";
      severity: AttentionSeverity;
      /** Plain English, ≤90 chars. May name the container/drive — this is a
       *  deliberately owner-facing surface (see the route's own comment). */
      headline: string;
      /** ≤140 chars. Supporting context, never required to make sense of the headline. */
      detail?: string;
      /** ISO timestamp of when the condition started, when known. */
      since?: string;
    };

const CACHE_TTL_MS = 30_000;
const HEADLINE_MAX = 90;
const DETAIL_MAX = 140;
/** Same floor disk-growth.tsx uses before it trusts a first-vs-last delta as a
 *  real trend rather than noise — a window under a day is too short to call
 *  honestly, so a projection is skipped (never faked) below that. */
const THIN_HISTORY_MS = 24 * 60 * 60 * 1000;
const DISK_WARN_PCT = 85;
const GROWTH_HORIZON_DAYS = 30;

const globalForAttention = globalThis as unknown as {
  __attentionCache?: { data: AttentionResult; ts: number };
  __attentionRestartCounts?: Map<string, number>;
  __attentionDriveVerdicts?: Map<string, HealthVerdict>;
};

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function hit(severity: AttentionSeverity, headline: string, detail?: string, since?: string): AttentionResult {
  return {
    status: "attention",
    severity,
    headline: clip(headline, HEADLINE_MAX),
    detail: detail ? clip(detail, DETAIL_MAX) : undefined,
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
function probeContainerDeath(containers: RuntimeContainer[]): AttentionResult | null {
  const dead = containers.find((c) => c.state === "dead");
  if (dead) {
    const upSecs =
      dead.startedAt != null && dead.finishedAt != null ? (dead.finishedAt - dead.startedAt) / 1000 : null;
    return hit(
      "bad",
      `${dead.name} has died`,
      upSecs != null ? `was up ${formatUptime(upSecs)} before it went dead` : undefined,
      dead.finishedAt != null ? new Date(dead.finishedAt).toISOString() : undefined,
    );
  }

  const crashed = containers.find(
    (c) => c.state === "exited" && c.startedAt != null && c.exitCode != null && c.exitCode !== 0,
  );
  if (crashed) {
    return hit(
      "bad",
      `${crashed.name} exited unexpectedly (code ${crashed.exitCode})`,
      undefined,
      crashed.finishedAt != null ? new Date(crashed.finishedAt).toISOString() : undefined,
    );
  }

  return null;
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
function probeRestartLoop(containers: RuntimeContainer[]): AttentionResult | null {
  const counts = globalForAttention.__attentionRestartCounts ?? new Map<string, number>();
  globalForAttention.__attentionRestartCounts = counts;

  let result: AttentionResult | null = null;
  for (const c of containers) {
    if (!result && c.state === "restarting") {
      result = hit("bad", `${c.name} is stuck restart-looping`, `restart count ${c.restartCount}`);
    }
    if (!result) {
      const prev = counts.get(c.id);
      if (prev != null && c.restartCount > prev) {
        const delta = c.restartCount - prev;
        result = hit(
          "bad",
          `${c.name} keeps restarting`,
          `${delta} restart${delta === 1 ? "" : "s"} since the last check, ${c.restartCount} total`,
        );
      }
    }
    // Advance the baseline every call, win or not — the whole point is a
    // rolling "since last check" delta, not a fixed reference point.
    counts.set(c.id, c.restartCount);
  }
  return result;
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
async function probeSmart(): Promise<AttentionResult | null> {
  const snapshot = await getSmartSnapshot();

  if (snapshot.integrity.verdict === "bad") {
    return hit("bad", `Storage array problem: ${snapshot.integrity.reasons[0] ?? "degraded"}`);
  }

  const verdicts = globalForAttention.__attentionDriveVerdicts ?? new Map<string, HealthVerdict>();
  globalForAttention.__attentionDriveVerdicts = verdicts;

  let result: AttentionResult | null = null;
  for (const drive of snapshot.drives) {
    if (!result && drive.verdict === "bad") {
      result = hit("bad", `${drive.device} SMART: ${drive.reasons[0] ?? "failing"}`);
    }
    if (!result && drive.verdict === "unknown") {
      const prev = verdicts.get(drive.device);
      if (prev === "ok" || prev === "warn") {
        result = hit("warn", `${drive.device} SMART status became UNKNOWN`, drive.unavailableReason ?? undefined);
      }
    }
    verdicts.set(drive.device, drive.verdict);
  }
  return result;
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
async function probeDiskCapacity(): Promise<AttentionResult | null> {
  const vitals = await getHostVitals();

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
      const headline =
        days != null
          ? `${group.mount} ${percent}% — ~${days} ${days === 1 ? "day" : "days"} at current growth`
          : `${group.mount} ${percent}% used`;
      return hit("warn", headline);
    }
  }

  return null;
}

// --- (e) failing healthcheck -------------------------------------------------

function probeUnhealthy(containers: RuntimeContainer[]): AttentionResult | null {
  const c = containers.find((c) => c.health === "unhealthy");
  if (!c) return null;
  return hit("warn", `${c.name} is failing its healthcheck`);
}

// --- orchestration -----------------------------------------------------------

async function computeAttention(): Promise<AttentionResult> {
  // Fetched once and shared by every container-based probe below. If Docker
  // itself is unreachable this simply leaves those probes with nothing to
  // find — never an error surfaced as an alert.
  let containers: RuntimeContainer[] = [];
  try {
    containers = await listContainersWithRuntime();
  } catch {
    containers = [];
  }

  const probes: (() => AttentionResult | null | Promise<AttentionResult | null>)[] = [
    () => probeContainerDeath(containers),
    () => probeRestartLoop(containers),
    () => probeSmart(),
    () => probeDiskCapacity(),
    () => probeUnhealthy(containers),
  ];

  for (const probe of probes) {
    try {
      const found = await probe();
      if (found) return found;
    } catch {
      // Errors in any probe = skip that probe silently — a broken probe must
      // never fabricate an alert (or fail the whole evaluation).
    }
  }

  return { status: "quiet" };
}

/** Module-level 30s cache — the kiosk polls this every 30s anyway, so there's
 *  no reason to re-run five probes (one of which does file IO across two
 *  history reads) more often than the UI could show a change. */
export async function getAttention(): Promise<AttentionResult> {
  const cached = globalForAttention.__attentionCache;
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const result = await computeAttention();
  globalForAttention.__attentionCache = { data: result, ts: Date.now() };
  return result;
}
