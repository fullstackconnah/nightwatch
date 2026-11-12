/* The change log's disk side: one JSONL file per UTC day plus an atomic baseline file,
 * beside the metrics history. Imports only node:fs, node:path and ./change-log.ts, so
 * node:test can load it. */
import fs from "node:fs/promises";
import path from "node:path";
import { diffTick, parseBaseline, parseLines, type Baseline, type ChangeLine, type LiveContainer } from "./change-log.ts";

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 30;
const MAX_DAY_FILE_BYTES = 1024 * 1024;
const FILE_RE = /^changes-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const BASELINE_FILE = "changes-baseline.json";

// State on globalThis so dev HMR keeps one writer, as metrics-history.ts does.
const g = globalThis as unknown as {
  __changeLogBaseline?: Baseline | null;
  __changeLogBusy?: boolean;
  __changeLogPrunedDate?: string;
  __changeLogWarned?: Set<string>;
};

/** Tests only: forget the in-memory baseline, the busy flag, the prune day and the warnings. */
export function resetChangeLogState(): void {
  g.__changeLogBaseline = undefined;
  g.__changeLogBusy = false;
  g.__changeLogPrunedDate = undefined;
  g.__changeLogWarned = undefined;
}

function warnOnce(reason: string, err?: unknown): void {
  const seen = (g.__changeLogWarned ??= new Set());
  if (seen.has(reason)) return;
  seen.add(reason);
  console.warn(`[change-log] ${reason}${err instanceof Error ? `: ${err.message}` : ""}`);
}

// dataDir and dateKey are copies of metrics-history.ts's (importing it pulls @/lib/docker); keep them identical.
const dataDir = (): string => process.env.DATA_DIR || path.join(process.cwd(), "data");
const dateKey = (ts: number): string => new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD, UTC
const historyDir = (): string => path.join(dataDir(), "history");

const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException | null)?.code === "ENOENT";

/** The stored baseline; null when missing, unreadable or corrupt. */
async function readBaseline(): Promise<Baseline | null> {
  try {
    return parseBaseline(await fs.readFile(path.join(historyDir(), BASELINE_FILE), "utf8"));
  } catch {
    return null;
  }
}

async function writeBaseline(b: Baseline): Promise<void> {
  const file = path.join(historyDir(), BASELINE_FILE);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(b));
  await fs.rename(tmp, file);
}

/** Delete changes-YYYY-MM-DD.jsonl files dated before the retention window; nothing else matches. */
async function prune(now: number): Promise<void> {
  const today = dateKey(now);
  if (g.__changeLogPrunedDate === today) return;
  g.__changeLogPrunedDate = today;
  const cutoff = dateKey(now - RETENTION_DAYS * DAY_MS);
  for (const name of await fs.readdir(historyDir())) {
    const m = FILE_RE.exec(name);
    if (m && m[1] < cutoff) await fs.unlink(path.join(historyDir(), name)).catch(() => {});
  }
}

/**
 * One tick of the log. Never throws. Lines are appended BEFORE the baseline rename, so
 * a crash between them re-writes lines (deduped on read) and never loses one. A list
 * that throws, or a tick still running, writes nothing.
 */
export async function recordChangeLogTick(ts: number, load: () => Promise<LiveContainer[]>): Promise<void> {
  if (g.__changeLogBusy) return;
  g.__changeLogBusy = true;
  try {
    const live = await load();
    const stored = g.__changeLogBaseline !== undefined ? g.__changeLogBaseline : await readBaseline();
    if (stored === null) warnOnce("no usable baseline; reseeded, so earlier events are not recovered");
    const { lines, baseline } = diffTick(stored, live, ts);
    g.__changeLogBaseline = baseline; // advance before the writes; a failed append below puts it back
    try {
      await fs.mkdir(historyDir(), { recursive: true });
      if (lines.length > 0) await appendLines(ts, lines);
    } catch (err) {
      g.__changeLogBaseline = stored;
      warnOnce("append failed; will retry next tick", err);
      return;
    }
    await writeBaseline(baseline).catch((err) => warnOnce("baseline write failed", err));
    await prune(ts).catch((err) => warnOnce("prune failed", err));
  } catch (err) {
    warnOnce("tick failed", err);
  } finally {
    g.__changeLogBusy = false;
  }
}

async function appendLines(ts: number, lines: ChangeLine[]): Promise<void> {
  const file = path.join(historyDir(), `changes-${dateKey(ts)}.jsonl`);
  const size = await fs.stat(file).then((s) => s.size, () => 0);
  if (size >= MAX_DAY_FILE_BYTES) {
    warnOnce("a day file reached 1 MiB; events past the cap are dropped, not replayed later");
    return;
  }
  // a leading newline ends any fragment a cut-off write left; the reader skips blank lines
  await fs.appendFile(file, `\n${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

/**
 * The lines that can fall after `sinceMs` (an event was written at or after its own time, so a
 * file dated before `since` holds none) and the date the log covers from. A missing
 * baseline or any read failure gives no lines and `loggedFrom: null` (live-only rows).
 */
// shortcut: reads and parses up to 30 day files per call, add an mtime cache like metrics-history when the attention route gets slow
export async function readChangeLog(sinceMs: number, now: number): Promise<{ lines: ChangeLine[]; loggedFrom: number | null }> {
  try {
    const baseline = g.__changeLogBaseline ?? (await readBaseline());
    if (!baseline) return { lines: [], loggedFrom: null };
    const first = dateKey(sinceMs);
    let names: string[] = [];
    try {
      names = (await fs.readdir(historyDir())).filter((n) => {
        const m = FILE_RE.exec(n);
        return m !== null && m[1] >= first;
      });
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    const lines = (await Promise.all(names.map((n) => fs.readFile(path.join(historyDir(), n), "utf8")))).flatMap(parseLines);
    return { lines, loggedFrom: Math.max(baseline.seededAt, now - RETENTION_DAYS * DAY_MS) };
  } catch {
    return { lines: [], loggedFrom: null };
  }
}
