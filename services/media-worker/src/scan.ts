import { lstat as fsLstat, readdir } from "node:fs/promises";
import type { Stats } from "node:fs";
import { posix } from "node:path";
import { MEDIA_ROOTS } from "./paths.ts";
import type { FileStat } from "./probe.ts";
import { readJson, writeJsonAtomic } from "./state.ts";
import { thresholds } from "./sweet-spot.ts";
import type { MediaFile, ScanState } from "./types.ts";
import { verdict, type VerdictInput } from "./verdict.ts";

export const VIDEO_EXT = new Set([
  "mkv", "mp4", "m4v", "mov", "avi", "wmv", "asf", "flv", "mpg", "mpeg", "vob", "ts", "m2ts", "webm",
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 1;

interface CacheFile { version: number; scannedAt: string | null; files: Record<string, MediaFile> }

export interface ScannerOpts {
  mediaRoot: string;
  stateDir: string;
  probe: (abs: string, st: FileStat) => Promise<VerdictInput>;
  lstat?: (p: string) => Promise<Stats>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  flushEvery?: number;
  concurrency?: number;
  log?: (line: string) => void;
}

export interface Scanner {
  state(): ScanState;
  files(): Record<string, MediaFile>;
  scannedAt(): string | null;
  /** True when there is no cache or it is older than 24 h. */
  needsBootScan(): boolean;
  /** Starts a scan; false when one is already running. */
  start(): boolean;
  whenIdle(): Promise<void>;
  /** Re-probes one file after a swap or Undo, so the library shows its new codec and size at once. */
  refreshFile(rel: string): Promise<void>;
}

const hasVideoExt = (name: string) => VIDEO_EXT.has(name.slice(name.lastIndexOf(".") + 1).toLowerCase());

export function createScanner(opts: ScannerOpts): Scanner {
  const now = opts.now ?? (() => new Date());
  const lstat = opts.lstat ?? fsLstat;
  const flushEvery = opts.flushEvery ?? 200;
  const concurrency = opts.concurrency ?? 2;
  const cacheFile = posix.join(opts.stateDir, "scan.json");

  let files: Record<string, MediaFile> = {};
  let scannedAt: string | null = null;
  let state: ScanState = { state: "idle", startedAt: null, finishedAt: null, filesDone: 0, filesTotal: null, skipped: 0 };
  let running: Promise<void> = Promise.resolve();

  const cached = readJson<CacheFile>(cacheFile);
  if (cached?.version === CACHE_VERSION) ({ files, scannedAt } = cached);

  const flush = () => writeJsonAtomic(cacheFile, { version: CACHE_VERSION, scannedAt, files } satisfies CacheFile);

  /** lstat walk of movies/ and tv/; never follows a symlink and never aborts on one bad entry. */
  async function walk(): Promise<(FileStat & { abs: string })[]> {
    const found: (FileStat & { abs: string })[] = [];
    const visit = async (rel: string, top: boolean): Promise<void> => {
      let entries;
      try {
        entries = await readdir(posix.join(opts.mediaRoot, rel), { withFileTypes: true });
      } catch (e) {
        // A missing movies/ or tv/ is a failed scan (the old cache stays), never an empty library.
        if (top) throw e;
        state.skipped++;
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const childRel = `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          await visit(childRel, false);
        } else if (entry.isFile() && hasVideoExt(entry.name)) {
          const abs = posix.join(opts.mediaRoot, childRel);
          try {
            const s = await lstat(abs);
            if (!s.isFile()) continue;
            found.push({ abs, path: childRel, name: entry.name, bytes: s.size, mtimeMs: s.mtimeMs, nlink: s.nlink });
          } catch {
            state.skipped++;
          }
        }
      }
    };
    for (const root of MEDIA_ROOTS) await visit(root, true);
    return found;
  }

  const judge = (p: VerdictInput, path: string) => verdict(p, path.startsWith("movies/") ? "film" : "tv", thresholds(opts.env));

  async function run(): Promise<void> {
    try {
      const found = await walk();
      state.filesTotal = found.length;
      const present = new Set(found.map((f) => f.path));
      for (const key of Object.keys(files)) if (!present.has(key)) delete files[key];

      const todo = found.filter((f) => {
        const c = files[f.path];
        const same = c && c.bytes === f.bytes && c.mtimeMs === f.mtimeMs && c.nlink === f.nlink && !c.probeError;
        if (same) { state.filesDone++; files[f.path] = { ...c, verdict: judge(c, f.path) }; }
        return !same;
      });

      let next = 0;
      let sinceFlush = 0;
      const worker = async () => {
        while (next < todo.length) {
          const { abs, ...st } = todo[next++];
          try {
            const p = await opts.probe(abs, st);
            files[st.path] = { ...p, verdict: judge(p, st.path) };
          } catch {
            state.skipped++;
          }
          state.filesDone++;
          if (++sinceFlush >= flushEvery) { sinceFlush = 0; flush(); }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));

      scannedAt = now().toISOString();
      flush();
      state = { ...state, state: "idle", finishedAt: scannedAt };
    } catch (e) {
      state = { ...state, state: "failed", finishedAt: now().toISOString(), error: (e as Error).message };
      opts.log?.(`scan failed: ${(e as Error).message}`);
    }
  }

  return {
    state: () => ({ ...state }),
    files: () => files,
    scannedAt: () => scannedAt,
    needsBootScan: () => scannedAt === null || now().getTime() - Date.parse(scannedAt) > DAY_MS,
    start() {
      if (state.state === "running") return false;
      state = { state: "running", startedAt: now().toISOString(), finishedAt: null, filesDone: 0, filesTotal: null, skipped: 0 };
      running = run();
      return true;
    },
    whenIdle: () => running,
    async refreshFile(rel) {
      const abs = posix.join(opts.mediaRoot, rel);
      try {
        const s = await lstat(abs);
        const st = { path: rel, name: posix.basename(rel), bytes: s.size, mtimeMs: s.mtimeMs, nlink: s.nlink };
        const p = await opts.probe(abs, st);
        files[rel] = { ...p, verdict: judge(p, rel) };
        flush();
      } catch (e) {
        opts.log?.(`refresh of one file failed: ${(e as Error).name}`);
      }
    },
  };
}

/** Next local occurrence of `hour`:00 strictly after `now` (the TZ env sets the zone). */
export function nextRunAt(now: Date, hour = 4): Date {
  const t = new Date(now);
  t.setHours(hour, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t;
}

export function scheduleNightly(
  run: () => void,
  opts: { now?: () => Date; setTimer?: (fn: () => void, ms: number) => unknown; hour?: number } = {},
): { stop(): void } {
  const now = opts.now ?? (() => new Date());
  const setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; });
  let stopped = false;
  const arm = () => {
    setTimer(() => {
      if (stopped) return;
      run();
      arm();
    }, nextRunAt(now(), opts.hour).getTime() - now().getTime());
  };
  arm();
  return { stop: () => { stopped = true; } };
}
