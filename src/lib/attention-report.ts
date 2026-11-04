/* The attention report: pure types and functions. Relative or type-only imports
 * so node:test can load it (no "@/" alias). attention.ts does the IO. */
import type { RuntimeContainer } from "./docker.ts";
import { BACKUP_KIND_LABEL, type BackupStatus } from "./backup-status.ts";

export type ProbeId = "crashes" | "restarts" | "smart" | "mounts" | "backup" | "disks" | "health" | "orchestra";
export type ProbeStatus =
  | { id: ProbeId; label: string; state: "answered"; hits: number }
  | { id: ProbeId; label: string; state: "pending" } // missed the deadline
  | { id: ProbeId; label: string; state: "failed"; error: string }; // threw; error clipped to 140
export interface AttentionHit {
  id: string; // `${probe}:${subject}`, stable across ticks
  probe: ProbeId;
  subject: string; // "container:radarr" | "drive:sda" | "array" | "mount:/mnt/media" | "disk:/mnt/media" | "backup" | "orchestra"
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
  probes: ProbeStatus[]; // always 8, in priority order
  hits: AttentionHit[]; // sortHits: bad first, then oldest (since ?? firstSeen)
  changes: { since: string; status: "answered" | "failed"; error?: string; events: ChangeEvent[] };
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
    case "orchestra":
      return { href: "/orchestrators", label: "Open AI lanes" };
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
 */
export function deriveChanges(
  containers: RuntimeContainer[],
  backup: BackupStatus | null,
  sinceMs: number,
  hitSubjects: Iterable<string>,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const groups = new Map<string, { handled: boolean; names: string[]; at: number }>();
  for (const c of containers) {
    if (c.state === "running" && c.startedAt != null && c.startedAt > sinceMs) {
      const handled = c.restartCount > 0; // shortcut: restartCount is cumulative, not counted since `since`; upgrade when restart history is recorded
      const key = `${c.composeProject ?? c.name}|${Math.floor(c.startedAt / 60_000)}|${handled}`;
      const g = groups.get(key) ?? { handled, names: [], at: 0 };
      g.names.push(c.name);
      g.at = Math.max(g.at, c.startedAt);
      groups.set(key, g);
    } else if (c.state === "exited" && c.finishedAt != null && c.finishedAt > sinceMs) {
      events.push({
        id: `change:stopped:${c.name}:${c.finishedAt}`,
        kind: "routine",
        at: new Date(c.finishedAt).toISOString(),
        subjects: [`container:${c.name}`],
        text: `${c.name} stopped${c.exitCode != null ? ` (exit ${c.exitCode})` : ""}`,
        owner: containerOwner([c.name]),
      });
    }
  }
  for (const [key, g] of groups) {
    events.push({
      id: `change:${key}`,
      kind: g.handled ? "handled" : "routine",
      at: new Date(g.at).toISOString(),
      subjects: g.names.map((n) => `container:${n}`),
      text: `${list(g.names)} ${g.handled ? "restarted itself and is running again" : "started"}`,
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
