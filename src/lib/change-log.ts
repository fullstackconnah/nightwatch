/* The stored container change log: pure types and functions. No imports, so node:test
 * can load it (no "@/" alias). change-log-store.ts does the IO. */

export type ChangeKind = "start" | "restart" | "stop" | "recreate";
/** One event per file line. `at` is Docker's own time, not the tick's. `n` on `restart` only; `code` on `stop` when known. */
export interface ChangeLine {
  at: number;
  k: ChangeKind;
  name: string;
  id: string;
  n?: number;
  code?: number;
}

/** The part of a RuntimeContainer the log reads (structural, so docker.ts is not imported). */
export interface LiveContainer {
  id: string;
  name: string;
  state: string;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  /** Counts restarts made by the restart policy; may reset, so a decrease is not an event. */
  restartCount: number;
}

export interface BaselineEntry {
  id: string;
  startedAt: number | null;
  finishedAt: number | null;
  restartCount: number;
  /** Last tick that saw this name, ms. */
  seen: number;
}
export interface Baseline {
  seededAt: number;
  /** ms of the previous completed tick. */
  lastTickAt: number;
  byName: Record<string, BaselineEntry>;
}

const DAY_MS = 86_400_000;
const KINDS: readonly ChangeKind[] = ["start", "restart", "stop", "recreate"];

/** Docker reported nothing usable: running without a start time, or not running with no times at all. */
const unknownRuntime = (c: LiveContainer): boolean =>
  c.state === "running" ? c.startedAt === null : c.startedAt === null && c.finishedAt === null;

const line = (at: number, k: ChangeKind, c: LiveContainer, extra: { n?: number; code?: number } = {}): ChangeLine => ({
  at,
  k,
  name: c.name,
  id: c.id.slice(0, 12),
  ...extra,
});

/**
 * One tick: what changed between the stored baseline and the live containers.
 * `baseline === null` (first tick, or a missing/corrupt file) seeds silently, so a
 * boot never writes a storm. A container whose runtime is unknown is not an
 * observation: nothing is written and its stored entry is kept.
 */
export function diffTick(
  baseline: Baseline | null,
  liveContainers: LiveContainer[],
  now: number,
): { lines: ChangeLine[]; baseline: Baseline } {
  const lines: ChangeLine[] = [];
  const prev = baseline?.byName ?? {};
  const byName: Record<string, BaselineEntry> = { ...prev };
  const idToName = new Map(Object.entries(prev).map(([n, e]) => [e.id, n]));
  const liveNames = new Set(liveContainers.map((c) => c.name));
  const entry = (c: LiveContainer): BaselineEntry => ({
    id: c.id,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    restartCount: c.restartCount,
    seen: now,
  });

  for (const c of liveContainers) {
    if (unknownRuntime(c)) continue;
    const old = prev[c.name];
    if (!old) {
      const renamedFrom = idToName.get(c.id);
      if (renamedFrom !== undefined && !liveNames.has(renamedFrom)) delete byName[renamedFrom];
      else if (baseline && c.state === "running" && c.startedAt !== null && c.startedAt > baseline.lastTickAt) {
        // Unseen name: only a start after the previous completed tick is real; older ones are a seed that missed it.
        lines.push(line(c.startedAt, "start", c));
      }
      byName[c.name] = entry(c);
      continue;
    }
    if (old.id !== c.id) {
      if (c.state === "running" && c.startedAt !== null) lines.push(line(c.startedAt, "recreate", c));
      byName[c.name] = entry(c);
    } else if (c.state === "running") {
      if (c.startedAt !== old.startedAt && c.startedAt !== null) {
        const delta = c.restartCount - old.restartCount;
        lines.push(delta > 0 ? line(c.startedAt, "restart", c, { n: delta }) : line(c.startedAt, "start", c));
      }
      byName[c.name] = entry(c);
    } else if (c.state === "exited" || c.state === "dead") {
      if (c.finishedAt !== null && c.finishedAt !== old.finishedAt) {
        lines.push(line(c.finishedAt, "stop", c, c.exitCode !== null ? { code: c.exitCode } : {}));
      }
      byName[c.name] = entry(c);
    } else {
      byName[c.name] = { ...old, seen: now }; // paused, restarting, created: no line, keep the stored facts
    }
  }
  for (const [name, e] of Object.entries(byName)) if (now - e.seen > 30 * DAY_MS) delete byName[name];
  return { lines, baseline: { seededAt: baseline?.seededAt ?? now, lastTickAt: now, byName } };
}

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

/** Valid lines only; a bad or half-written line is skipped, never fatal. */
export function parseLines(text: string): ChangeLine[] {
  const out: ChangeLine[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    let o: Record<string, unknown>;
    try {
      const p: unknown = JSON.parse(raw);
      if (p === null || typeof p !== "object" || Array.isArray(p)) continue;
      o = p as Record<string, unknown>;
    } catch {
      continue;
    }
    const { at, k, name, id, n, code } = o;
    if (typeof at !== "number" || !Number.isFinite(at) || Math.abs(at) > 8.64e15) continue; // 8.64e15 is the largest valid Date
    if (typeof k !== "string" || !KINDS.includes(k as ChangeKind)) continue;
    if (typeof name !== "string" || name === "" || name.length > 255 || typeof id !== "string") continue;
    if (n !== undefined && !(isInt(n) && n >= 1 && n <= 10000)) continue;
    if (code !== undefined && !isInt(code)) continue;
    out.push({ at, k: k as ChangeKind, name, id, ...(n !== undefined ? { n } : {}), ...(code !== undefined ? { code } : {}) });
  }
  return out;
}

/** A baseline file without finite `seededAt` and `lastTickAt`, or with a malformed entry, is corrupt (null: reseed). */
export function parseBaseline(text: string): Baseline | null {
  try {
    const o: unknown = JSON.parse(text);
    if (o === null || typeof o !== "object") return null;
    const { seededAt, lastTickAt, byName } = o as Record<string, unknown>;
    if (typeof seededAt !== "number" || !Number.isFinite(seededAt) || typeof lastTickAt !== "number" || !Number.isFinite(lastTickAt)) return null;
    if (byName === null || typeof byName !== "object" || Array.isArray(byName)) return null;
    const time = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x));
    for (const e of Object.values(byName as Record<string, unknown>)) {
      const r = e as Record<string, unknown> | null;
      if (!r || typeof r.id !== "string" || !time(r.startedAt) || !time(r.finishedAt) || typeof r.restartCount !== "number" || typeof r.seen !== "number") return null;
    }
    return { seededAt, lastTickAt, byName: byName as Record<string, BaselineEntry> };
  } catch {
    return null;
  }
}

export interface Tally {
  starts: number;
  byItself: number;
  lastStartAt: number;
  stops: number;
  lastStopAt: number;
  lastCode: number | null;
}

/** Per container name: the counts of lines after `sinceMs`. Duplicate lines (name, kind, at) count once. */
export function tally(lines: ChangeLine[], sinceMs: number): Map<string, Tally> {
  const out = new Map<string, Tally>();
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.at <= sinceMs) continue;
    const key = `${l.name}|${l.k}|${l.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = out.get(l.name) ?? { starts: 0, byItself: 0, lastStartAt: 0, stops: 0, lastStopAt: 0, lastCode: null };
    if (l.k === "stop") {
      t.stops += 1;
      if (l.at >= t.lastStopAt) {
        t.lastStopAt = l.at;
        t.lastCode = l.code ?? null;
      }
    } else {
      const n = l.k === "restart" ? (l.n ?? 1) : 1;
      t.starts += n;
      if (l.k === "restart") t.byItself += n;
      t.lastStartAt = Math.max(t.lastStartAt, l.at);
    }
    out.set(l.name, t);
  }
  return out;
}

/**
 * The row sentence (SHAPE copy table). `subject` is one name or a grouped list.
 * "restarted" counts every start in range; "by itself" counts the restart policy's.
 */
export function countText(
  subject: string,
  verb: "start" | "stop",
  t: { starts: number; byItself: number; running?: boolean } | { stops: number; lastCode: number | null },
): string {
  if (verb === "stop") {
    const { stops, lastCode } = t as { stops: number; lastCode: number | null };
    if (stops <= 1) return `${subject} stopped${lastCode !== null ? ` (exit ${lastCode})` : ""}`;
    return `${subject} stopped ${stops} times${lastCode !== null ? ` (last exit ${lastCode})` : ""}`;
  }
  const { starts, byItself, running } = t as { starts: number; byItself: number; running?: boolean };
  if (starts <= 1 && byItself > 0 && running === false) return `${subject} restarted itself`; // down: no "running again"
  if (starts <= 1) return byItself > 0 ? `${subject} restarted itself and is running again` : `${subject} started`;
  if (byItself === 0) return `${subject} restarted ${starts} times`;
  return byItself >= starts ? `${subject} restarted itself ${starts} times` : `${subject} restarted ${starts} times, ${byItself} by itself`;
}
