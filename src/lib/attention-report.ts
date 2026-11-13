/* The attention report: pure types and functions. Relative or type-only imports
 * so node:test can load it (no "@/" alias). attention.ts does the IO. */
import type { RuntimeContainer } from "./docker.ts";
import { countText, type Tally } from "./change-log.ts";
import { BACKUP_KIND_LABEL, type BackupStatus } from "./backup-status.ts";

export type ProbeId = "crashes" | "restarts" | "smart" | "mounts" | "backup" | "disks" | "health" | "doorbell" | "orchestra" | "outside";
export type ProbeStatus =
  | { id: ProbeId; label: string; state: "answered"; hits: number }
  | { id: ProbeId; label: string; state: "pending" } // missed the deadline
  | { id: ProbeId; label: string; state: "failed"; error: string }; // threw; error clipped to 140
export interface AttentionHit {
  id: string; // `${probe}:${subject}`, stable across ticks
  probe: ProbeId;
  subject: string; // "container:radarr" | "drive:sda" | "array" | "mount:/mnt/media" | "disk:/mnt/media" | "backup" | "doorbell" | "orchestra"
  severity: "warn" | "bad";
  headline: string;
  detail?: string;
  action?: string;
  since?: string; // the condition's own start when known (unchanged for the kiosk)
  firstSeen: string; // ISO, when this process first saw the id
  owner: { href: string; label: string };
}
export interface ChangeEvent {
  id: string;
  kind: "handled" | "routine";
  at: string; // ISO
  subjects: string[]; // "container:name" for each container in a grouped event, or ["backup"]
  text: string;
  owner: { href: string; label: string };
}
export interface AttentionReport {
  checkedAt: string; // when the memo computed, not the request time
  probes: ProbeStatus[]; // 9 in priority order, 10 when the outside check is on
  hits: AttentionHit[]; // sortHits: bad first, then oldest (since ?? firstSeen)
  changes: { since: string; status: "answered" | "failed"; error?: string; events: ChangeEvent[]; loggedFrom: string | null }; // loggedFrom: ISO date the stored log covers from; null = no log (live state only)
}

/** What a probe finds, before the report adds id, firstSeen and owner. */
export interface RawHit {
  subject: string;
  severity: "warn" | "bad";
  headline: string;
  detail?: string;
  action?: string;
  since?: string;
}

/** A probe that cannot answer yet (e.g. the orchestra memo has never settled) returns this. */
export const PENDING = Symbol("pending");

export interface ProbeDef {
  id: ProbeId;
  label: string;
  /** `isLate()` is true once this probe's deadline fired: skip any state write, the result is dropped. */
  run: (isLate: () => boolean) => RawHit[] | typeof PENDING | Promise<RawHit[] | typeof PENDING>;
}
export interface ProbeOutcome {
  status: ProbeStatus;
  hits: RawHit[];
}

const ERROR_MAX = 140;
export const clipError = (e: unknown): string => {
  const s = e instanceof Error ? e.message : String(e);
  return s.length <= ERROR_MAX ? s : `${s.slice(0, ERROR_MAX - 1).trimEnd()}…`;
};

/**
 * Runs every probe in parallel, each raced against `deadlineMs`. A throw is
 * `failed`, never "no hit"; a probe that misses the race is `pending` and its
 * late result is dropped (shortcut: a slow probe re-runs on the next 30 s
 * compute; memo per probe if one stays slow).
 */
export function runProbes(defs: ProbeDef[], deadlineMs: number): Promise<ProbeOutcome[]> {
  return Promise.all(
    defs.map(async ({ id, label, run }): Promise<ProbeOutcome> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let late = false;
      const deadline = new Promise<typeof PENDING>((resolve) => {
        timer = setTimeout(() => ((late = true), resolve(PENDING)), deadlineMs);
      });
      try {
        const found = await Promise.race([Promise.resolve().then(() => run(() => late)), deadline]);
        if (found === PENDING) return { status: { id, label, state: "pending" }, hits: [] };
        return { status: { id, label, state: "answered", hits: found.length }, hits: found };
      } catch (e) {
        return { status: { id, label, state: "failed", error: clipError(e) }, hits: [] };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

const RESOURCES_ALL = "/resources?metric=all&q=";
const DISKS = { href: "/resources?metric=disk", label: "Disks in Resources" };

/** Where the owner goes to act on a hit. */
export function ownerFor(probe: ProbeId, subject: string): { href: string; label: string } {
  switch (probe) {
    case "crashes":
    case "restarts":
    case "health":
      return { href: `${RESOURCES_ALL}${encodeURIComponent(subject.replace(/^container:/, ""))}`, label: "Open in Resources" };
    case "backup":
      return { href: "#backup", label: "Backup detail" };
    case "doorbell":
      return { href: "/smarthome", label: "Open Smart home" };
    case "orchestra":
      return { href: "/orchestrators", label: "Open AI lanes" };
    case "outside":
      return { href: "/resources", label: "Open in Resources" };
    default:
      return DISKS; // smart, mounts, disks
  }
}

/** Probe-ordered hits, ready for firstHit (the kiosk) and sortHits (Home). */
export function toHits(outcomes: ProbeOutcome[], firstSeenOf: (id: string) => string): AttentionHit[] {
  return outcomes.flatMap((o) =>
    o.hits.map((h): AttentionHit => {
      const id = `${o.status.id}:${h.subject}`;
      return { id, probe: o.status.id, ...h, firstSeen: firstSeenOf(id), owner: ownerFor(o.status.id, h.subject) };
    }),
  );
}

const stamp = (h: AttentionHit) => Date.parse(h.since ?? h.firstSeen);

/** Bad first, then oldest. Array.sort is stable, so ties keep probe order. */
export function sortHits(hits: AttentionHit[]): AttentionHit[] {
  return [...hits].sort((a, b) => Number(b.severity === "bad") - Number(a.severity === "bad") || stamp(a) - stamp(b));
}

export type KioskResult =
  | { status: "quiet" }
  | { status: "attention"; severity: "warn" | "bad"; headline: string; detail?: string; action?: string; since?: string };

/** Today's kiosk answer: the first hit in probe order, with the same key order and the raw `since`. */
export function firstHit(ordered: AttentionHit[]): KioskResult {
  const h = ordered[0];
  if (!h) return { status: "quiet" };
  return { status: "attention", severity: h.severity, headline: h.headline, detail: h.detail, action: h.action, since: h.since };
}

const DAY_MS = 86_400_000;

/** `?since=` as ms: missing, NaN, negative or future gives now - 24 h; older than 30 d is capped at now - 30 d. */
export function parseSince(raw: string | null | undefined, now: number): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > now) return now - DAY_MS;
  return Math.max(n, now - 30 * DAY_MS);
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const containerOwner = (names: string[]) =>
  names.length === 1
    ? { href: `${RESOURCES_ALL}${encodeURIComponent(names[0])}`, label: "Open in Resources" }
    : { href: "/resources", label: "Open in Resources" };

/**
 * What changed since `sinceMs`, newest first. Events whose subject is a
 * current hit are dropped (the feed never double-lists attention items).
 * Hidden tiles are filtered on the client.
 * `logged` is the stored change log's tally (change-log.ts); a live row and its
 * logged twin (same container, same verb) are one row. Without it, live state alone.
 */
export function deriveChanges(
  containers: RuntimeContainer[],
  backup: BackupStatus | null,
  sinceMs: number,
  hitSubjects: Iterable<string>,
  logged: Map<string, Tally> = new Map(),
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const groups = new Map<string, { names: string[]; at: number; starts: number; byItself: number; running: boolean }>();
  const addStart = (name: string, project: string | null, at: number, starts: number, byItself: number, running: boolean) => {
    const solo = starts > 1 && byItself > 0; // the "by itself" copy is per container: never grouped
    const down = byItself > 0 && !running; // a self-restarted container that is not running splits off its own row
    const key = `${solo ? name : (project ?? name)}|${Math.floor(at / 60_000)}|${byItself > 0}${starts > 1 ? `|${starts}` : ""}${solo ? `|${name}` : ""}${down ? "|down" : ""}`;
    const g = groups.get(key) ?? { names: [], at: 0, starts, byItself, running: !down };
    g.names.push(name);
    g.at = Math.max(g.at, at);
    groups.set(key, g);
  };
  const addStop = (name: string, at: number, stops: number, code: number | null) =>
    events.push({
      id: `change:stopped:${name}:${at}`,
      kind: "routine",
      at: new Date(at).toISOString(),
      subjects: [`container:${name}`],
      text: countText(name, "stop", { stops, lastCode: code }),
      owner: containerOwner([name]),
    });
  const liveNames = new Set<string>();
  for (const c of containers) {
    liveNames.add(c.name);
    const t = logged.get(c.name);
    const liveStart = c.state === "running" && c.startedAt != null && c.startedAt > sinceMs ? c.startedAt : null;
    const liveStop = c.state === "exited" && c.finishedAt != null && c.finishedAt > sinceMs ? c.finishedAt : null;
    if (t && t.starts > 0) {
      // A live start newer than the last logged one is not logged yet (next tick): count it too.
      const unlogged = liveStart !== null && liveStart > t.lastStartAt;
      addStart(c.name, c.composeProject, Math.max(t.lastStartAt, liveStart ?? 0), t.starts + (unlogged ? 1 : 0), t.byItself, c.state === "running");
    } else if (liveStart !== null) {
      addStart(c.name, c.composeProject, liveStart, 1, c.restartCount > 0 ? 1 : 0, true); // liveStart implies running
    }
    if (t && t.stops > 0) {
      const unlogged = liveStop !== null && liveStop > t.lastStopAt;
      addStop(c.name, Math.max(t.lastStopAt, liveStop ?? 0), t.stops + (unlogged ? 1 : 0), unlogged ? c.exitCode : t.lastCode);
    } else if (liveStop !== null) {
      addStop(c.name, liveStop, 1, c.exitCode);
    }
  }
  for (const [name, t] of logged) {
    if (liveNames.has(name)) continue; // a container gone from Docker keeps its logged rows
    if (t.starts > 0) addStart(name, null, t.lastStartAt, t.starts, t.byItself, false);
    if (t.stops > 0) addStop(name, t.lastStopAt, t.stops, t.lastCode);
  }
  for (const [key, g] of groups) {
    events.push({
      id: `change:${key}`,
      kind: g.byItself > 0 && g.running ? "handled" : "routine",
      at: new Date(g.at).toISOString(),
      subjects: g.names.map((n) => `container:${n}`),
      text: countText(list(g.names), "start", g),
      owner: containerOwner(g.names),
    });
  }
  if (backup?.status === "ok") {
    for (const i of backup.items) {
      if (i.state !== "OK" || i.at == null || Date.parse(i.at) <= sinceMs) continue;
      events.push({
        id: `change:backup:${i.kind}:${i.at}`,
        kind: "routine",
        at: i.at,
        subjects: ["backup"],
        text: `${BACKUP_KIND_LABEL[i.kind]} ran and passed`,
        owner: { href: "#backup", label: "Backup detail" },
      });
    }
  }
  const hits = new Set(hitSubjects);
  return events.filter((e) => !e.subjects.some((s) => hits.has(s))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Forget restart baselines of containers that no longer exist, so the map cannot grow for ever. */
export function pruneRestartCounts(counts: Map<string, number>, presentIds: Iterable<string>): void {
  const present = new Set(presentIds);
  for (const id of [...counts.keys()]) if (!present.has(id)) counts.delete(id);
}
