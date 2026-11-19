import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { listContainers } from "@/lib/docker";
import { accAdd, accMean, bucketWidthMs as bucketWidth, shouldSkipTick, type Acc } from "@/lib/metrics-history-math";
import { attachSummary, type SummaryMetric, type SummaryResult } from "@/lib/history-summary";

/**
 * Long-range metrics history: a sampler piggybacked on the existing 1Hz telemetry
 * loop (see telemetry.ts's tick()) that appends one compact JSON line every 30s to
 * `${DATA_DIR}/history/metrics-YYYY-MM-DD.jsonl`. This is an enhancement layered on
 * top of live telemetry, never a dependency of it: every failure here is caught and
 * swallowed (one console.warn per distinct failure reason, then silent) so a
 * read-only volume, a missing dir, or a Docker hiccup can never cost the 1Hz ring
 * a tick. State lives on globalThis, mirroring telemetry.ts's globalForTelemetry
 * pattern, so a Next dev HMR reload reuses the running throttle/cache instead of
 * resetting it.
 */

export const SAMPLE_INTERVAL_MS = 30_000;
const RETENTION_DAYS = 14;
const MAX_POINTS = 360;

/** One line of the JSONL history file. Container values are a positional tuple
 *  (not an object) to keep the on-disk format compact — 14 days of ~2880
 *  samples/day across ~26 containers adds up. */
export type MetricsHistoryContainerTuple = [cpuPct: number, memBytes: number, rxBps: number, txBps: number];

export interface MetricsHistorySample {
  t: number;
  cpu: number | null;
  memUsed: number;
  memTotal: number;
  mounts: Record<string, number>;
  containers: Record<string, MetricsHistoryContainerTuple>;
}

export interface MetricsHistoryTickInput {
  ts: number;
  host: { cpuPct: number; memUsed: number; memTotal: number } | null;
  mounts: { mount: string; used: number }[] | null;
  containers: Record<string, { cpuPct: number; memBytes: number; rxRate: number; txRate: number }>;
}

export type HistoryRange = "1h" | "24h" | "7d";

export interface HistoryBucket {
  t: number;
  cpuPct: number | null;
  memBytes: number | null;
}

export interface HistoryQueryResult {
  /** Timestamp of the oldest sample across ALL retained history (not just the
   *  requested range) — null when nothing has been recorded yet. */
  recordingSince: number | null;
  host: HistoryBucket[];
  containers: Record<string, HistoryBucket[]>;
}

/** Present only when the caller asked for `summary` (Timeline view). */
export type HistoryQueryWithSummary = HistoryQueryResult & Partial<SummaryResult>;

const RANGE_MS: Record<HistoryRange, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/** `mtimeMs` + `fileSize` are the stat the entry was read at (a hit needs both to match);
 *  `size` is how many bytes are parsed into `samples` (less than `fileSize` while a torn last line waits). */
interface TailState {
  mtimeMs: number;
  fileSize: number;
  size: number;
}

interface FileCacheEntry extends TailState {
  samples: MetricsHistorySample[];
  lastUsed: number;
}

/** What the mount-growth reader keeps: it never reads cpu, mem or containers. */
type MountSample = Pick<MetricsHistorySample, "t" | "mounts">;

// Ten 30 s polls, so two views polling different ranges never evict each other.
const FILE_CACHE_IDLE_MS = 5 * 60_000;

const globalForHistory = globalThis as unknown as {
  __metricsHistoryLastSampleTs?: number;
  __metricsHistoryLastPrunedDate?: string;
  __metricsHistoryWarned?: Set<string>;
  __metricsHistoryFileCache?: Map<string, FileCacheEntry>;
  __metricsHistoryMountCache?: Map<string, TailState & { samples: MountSample[] }>;
  __metricsHistoryWriting?: boolean;
  __metricsHistorySince?: Map<string, number>;
};

const HEAD_BYTES = 64 * 1024;

function sinceMemo(): Map<string, number> {
  if (!globalForHistory.__metricsHistorySince) globalForHistory.__metricsHistorySince = new Map();
  return globalForHistory.__metricsHistorySince;
}

const WRITE_FAILED = "write failed — history dir unwritable";

function warnedSet(): Set<string> {
  if (!globalForHistory.__metricsHistoryWarned) globalForHistory.__metricsHistoryWarned = new Set();
  return globalForHistory.__metricsHistoryWarned;
}

/** Logs a failure once per distinct reason until the next successful append clears
 *  the set — history must degrade silently, and a dashboard that re-warns every 30s
 *  about an unwritable volume is just noise nobody reads. */
function warnOnce(reason: string, err: unknown): void {
  const seen = warnedSet();
  if (seen.has(reason)) return;
  seen.add(reason);
  console.warn(`[metrics-history] ${reason}:`, err instanceof Error ? err.message : err);
}

function fileCache(): Map<string, FileCacheEntry> {
  if (!globalForHistory.__metricsHistoryFileCache) globalForHistory.__metricsHistoryFileCache = new Map();
  return globalForHistory.__metricsHistoryFileCache;
}

function mountCache(): Map<string, TailState & { samples: MountSample[] }> {
  if (!globalForHistory.__metricsHistoryMountCache) globalForHistory.__metricsHistoryMountCache = new Map();
  return globalForHistory.__metricsHistoryMountCache;
}

/** Same resolution as config.ts's dataDir(): DATA_DIR env var (a mounted volume
 *  in production, uid-1000-writable) or ./data in dev. Not imported from config.ts
 *  because that helper isn't exported there and config.ts is owned by another
 *  surface of this app — duplicating four lines is cheaper than widening its API. */
function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function historyDir(): string {
  return path.join(dataDir(), "history");
}

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

function filePathForDate(date: string): string {
  return path.join(historyDir(), `metrics-${date}.jsonl`);
}

const FILE_NAME_RE = /^metrics-(\d{4}-\d{2}-\d{2})\.jsonl$/;

function listHistoryFilesSync(): { date: string; path: string }[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(historyDir());
  } catch {
    return [];
  }
  const files = entries
    .map((name) => {
      const m = FILE_NAME_RE.exec(name);
      return m ? { date: m[1], path: path.join(historyDir(), name) } : null;
    })
    .filter((f): f is { date: string; path: string } => f !== null);
  files.sort((a, b) => a.date.localeCompare(b.date));
  return files;
}

/** Deletes daily files whose date is older than the retention window. Called at
 *  most once per calendar-day rollover (tracked in globalThis), not on every
 *  30s write — pruning is cheap but there is no reason to stat the whole
 *  directory every tick. */
async function pruneOldFiles(today: string): Promise<void> {
  if (globalForHistory.__metricsHistoryLastPrunedDate === today) return;
  globalForHistory.__metricsHistoryLastPrunedDate = today;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate = dateKey(cutoff);
  for (const f of listHistoryFilesSync()) {
    if (f.date < cutoffDate) {
      try {
        await fsp.unlink(f.path);
        fileCache().delete(f.path);
        mountCache().delete(f.path);
        sinceMemo().delete(f.path);
      } catch (err) {
        warnOnce("prune failed", err);
      }
    }
  }
}

async function writeSample(input: MetricsHistoryTickInput): Promise<void> {
  if (!input.host) return; // no host vitals this tick — nothing worth recording

  const date = dateKey(input.ts);
  const dir = historyDir();

  let names: Record<string, string> = {};
  try {
    const list = await listContainers();
    names = Object.fromEntries(list.map((c) => [c.id, c.name]));
  } catch (err) {
    // Best-effort: a Docker hiccup loses this tick's container attribution but
    // must not lose the host-level sample.
    warnOnce("container name lookup failed", err);
  }

  const containers: Record<string, MetricsHistoryContainerTuple> = {};
  for (const [id, row] of Object.entries(input.containers)) {
    const name = names[id];
    if (!name) continue; // container vanished between allContainerStats and listContainers
    containers[name] = [
      Math.round(row.cpuPct * 100) / 100,
      Math.round(row.memBytes),
      Math.round(row.rxRate),
      Math.round(row.txRate),
    ];
  }

  const mounts: Record<string, number> = {};
  for (const m of input.mounts ?? []) {
    mounts[m.mount] = Math.round(m.used);
  }

  const sample: MetricsHistorySample = {
    t: input.ts,
    cpu: Number.isFinite(input.host.cpuPct) ? Math.round(input.host.cpuPct * 10) / 10 : null, // null = missing; readers skip it
    memUsed: Math.round(input.host.memUsed),
    memTotal: Math.round(input.host.memTotal),
    mounts,
    containers,
  };

  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.appendFile(filePathForDate(date), `\n${JSON.stringify(sample)}\n`, "utf8");
    // A healthy append re-arms the write warning (only that one: the Docker-lookup warning fires in the same tick and would repeat every 30 s).
    warnedSet().delete(WRITE_FAILED);
  } catch (err) {
    warnOnce(WRITE_FAILED, err);
  }

  await pruneOldFiles(date);
}

/**
 * Called every 1Hz telemetry tick (see telemetry.ts). Internally throttles to
 * one write per 30s using globalThis state, so the caller doesn't need its own
 * tick counter. Fire-and-forget by design — never awaited, never throws
 * synchronously, so a slow or failing disk cannot add latency to the live
 * telemetry loop it rides on.
 */
export function recordMetricsHistoryTick(input: MetricsHistoryTickInput): void {
  const last = globalForHistory.__metricsHistoryLastSampleTs ?? 0;
  if (shouldSkipTick(input.ts, last, SAMPLE_INTERVAL_MS)) return;
  // One write at a time: on a hung volume each stuck write holds a libuv thread. A skipped tick leaves the clock alone, so the next tick after the write settles records.
  if (globalForHistory.__metricsHistoryWriting) return;
  // Set before the write resolves — a slow write must not cause a second tick to
  // pile on another write once the interval has merely nearly elapsed.
  globalForHistory.__metricsHistoryLastSampleTs = input.ts;
  globalForHistory.__metricsHistoryWriting = true;
  void writeSample(input)
    .catch((err) => warnOnce("sample write threw", err))
    .finally(() => {
      globalForHistory.__metricsHistoryWriting = false;
    });
}

function evictIdleFiles(now: number): void {
  const cache = fileCache();
  for (const [p, e] of cache) if (now - e.lastUsed > FILE_CACHE_IDLE_MS) cache.delete(p);
}

/** Parses one JSONL file, using a globalThis cache keyed by path + mtime so a
 *  7-day query (up to 8 files) doesn't re-read and re-parse every file on every
 *  ~30s poll — only files that changed since the last read are touched. */
async function readFileCached(filePath: string): Promise<MetricsHistorySample[]> {
  const cache = fileCache();
  const now = Date.now();
  evictIdleFiles(now);

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return [];
  }
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.fileSize === stat.size) {
    cached.lastUsed = now;
    return cached.samples;
  }

  try {
    const { samples, size } = await readGrown(filePath, stat, cached, (s) => s);
    cache.set(filePath, { mtimeMs: stat.mtimeMs, fileSize: stat.size, size, samples, lastUsed: now });
    return samples;
  } catch (err) {
    warnOnce("read failed", err);
    return cached?.samples ?? [];
  }
}

/** One corrupt line (e.g. a torn write mid-append) must not invalidate the rest
 *  of the day's file; `keep` lets a reader retain only the fields it uses.
 *  `consumed` (bytes) stops before a trailing line that has no newline yet and does
 *  not parse, so the next tail read starts at it again once it is complete. */
function parseChunk<T>(buf: Buffer, keep: (s: MetricsHistorySample) => T): { samples: T[]; consumed: number } {
  // Offsets come from the bytes, never the decoded text: a line torn inside a multi-byte character decodes to U+FFFD, which is longer than what is on disk.
  const end = buf.lastIndexOf(10) + 1;
  const samples: T[] = [];
  const take = (line: string): boolean => {
    if (!line.trim()) return true;
    try {
      const s = JSON.parse(line) as MetricsHistorySample | null;
      if (s && typeof s === "object") samples.push(keep(s)); // a bare `null` line parses but is not a sample
      return !!s && typeof s === "object";
    } catch {
      return false;
    }
  };
  for (const line of buf.toString("utf8", 0, end).split("\n")) take(line);
  return { samples, consumed: take(buf.toString("utf8", end)) ? buf.length : end };
}

/** Samples of a changed file: an append-only file that grew is tail-read from the
 *  parsed offset into a NEW array (a running query may still hold the old one);
 *  anything else (no entry, shrunk, same size but touched) is read in full. */
async function readGrown<T>(
  filePath: string,
  stat: fs.Stats,
  cached: (TailState & { samples: T[] }) | undefined,
  keep: (s: MetricsHistorySample) => T,
): Promise<{ samples: T[]; size: number }> {
  if (cached && stat.size > cached.fileSize) {
    const fh = await fsp.open(filePath, "r");
    try {
      const buf = Buffer.alloc(stat.size - cached.size);
      const { bytesRead } = await fh.read(buf, 0, buf.length, cached.size);
      const { samples, consumed } = parseChunk(buf.subarray(0, bytesRead), keep);
      return { samples: cached.samples.concat(samples), size: cached.size + consumed };
    } finally {
      await fh.close();
    }
  }
  const { samples, consumed } = parseChunk(await fsp.readFile(filePath), keep);
  return { samples, size: consumed };
}

const toMountSample = (s: MetricsHistorySample): MountSample => ({ t: s.t, mounts: s.mounts });

/** Like readFileCached but keeps only {t, mounts}: the 14d growth query would
 *  otherwise hold every fully parsed day (all containers) for as long as it
 *  runs. Reuses the full cache's entry when it is current; never writes to it. */
async function readMountsCached(filePath: string): Promise<MountSample[]> {
  evictIdleFiles(Date.now()); // the 30 s mount poll is the only caller left once nobody views history
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return [];
  }
  const cache = mountCache();
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.fileSize === stat.size) return cached.samples;

  const full = fileCache().get(filePath);
  let samples: MountSample[];
  let size: number;
  if (full && full.mtimeMs === stat.mtimeMs && full.fileSize === stat.size) {
    samples = full.samples.map(toMountSample);
    size = full.size;
  } else {
    try {
      ({ samples, size } = await readGrown(filePath, stat, cached, toMountSample));
    } catch (err) {
      warnOnce("read failed", err);
      return cached?.samples ?? [];
    }
  }
  cache.set(filePath, { mtimeMs: stat.mtimeMs, fileSize: stat.size, size, samples });
  return samples;
}

/** Oldest sample timestamp across every retained file — read from the oldest
 *  file's first line only (not a full scan), so this stays cheap. */
async function recordingSince(): Promise<number | null> {
  const files = listHistoryFilesSync();
  if (files.length === 0) return null;
  const oldest = files[0].path;
  const memo = sinceMemo();
  const known = memo.get(oldest);
  if (known !== undefined) return known;

  // Only the head of the file: never parse (or cache) a whole day for one timestamp.
  let head = "";
  try {
    const fh = await fsp.open(oldest, "r");
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
      head = buf.toString("utf8", 0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch (err) {
    warnOnce("read failed", err);
    return null;
  }
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    try {
      const t = (JSON.parse(line) as { t?: unknown }).t;
      if (typeof t === "number") {
        memo.set(oldest, t); // the oldest file's first sample never changes while it is the oldest
        return t;
      }
    } catch {
      // torn write or the 64 KB cut: try the next line
    }
  }
  return null;
}

type Bucket = { cpu: Acc; mem: Acc };

function bucketWidthMs(rangeMs: number): number {
  return bucketWidth(rangeMs, SAMPLE_INTERVAL_MS, MAX_POINTS);
}

/** Averages samples into fixed-width, epoch-aligned buckets across [startTs,
 *  endTs]. A bucket with no samples in it is emitted as a null-valued point — a
 *  real gap, never interpolated across from its neighbours (Hatch-Not-Empty
 *  rule: an absent measurement must not be drawn as if it were measured). */
function downsampleHost(samples: MetricsHistorySample[], startTs: number, endTs: number, widthMs: number): HistoryBucket[] {
  const buckets = new Map<number, Bucket>();
  for (const s of samples) {
    if (s.t < startTs || s.t > endTs) continue;
    const key = Math.floor(s.t / widthMs) * widthMs;
    let b = buckets.get(key);
    if (!b) {
      b = { cpu: { sum: 0, n: 0 }, mem: { sum: 0, n: 0 } };
      buckets.set(key, b);
    }
    accAdd(b.cpu, s.cpu);
    accAdd(b.mem, s.memUsed);
  }
  return emitBuckets(buckets, startTs, endTs, widthMs);
}

function downsampleContainer(samples: MetricsHistorySample[], name: string, startTs: number, endTs: number, widthMs: number): HistoryBucket[] {
  const buckets = new Map<number, Bucket>();
  for (const s of samples) {
    if (s.t < startTs || s.t > endTs) continue;
    const row = s.containers[name];
    if (!row) continue;
    const key = Math.floor(s.t / widthMs) * widthMs;
    let b = buckets.get(key);
    if (!b) {
      b = { cpu: { sum: 0, n: 0 }, mem: { sum: 0, n: 0 } };
      buckets.set(key, b);
    }
    accAdd(b.cpu, row[0]);
    accAdd(b.mem, row[1]);
  }
  return emitBuckets(buckets, startTs, endTs, widthMs);
}

function emitBuckets(
  buckets: Map<number, Bucket>,
  startTs: number,
  endTs: number,
  widthMs: number,
): HistoryBucket[] {
  const first = Math.floor(startTs / widthMs) * widthMs;
  const last = Math.floor(endTs / widthMs) * widthMs;
  const out: HistoryBucket[] = [];
  for (let t = first; t <= last; t += widthMs) {
    const b = buckets.get(t);
    out.push({
      t,
      cpuPct: b ? accMean(b.cpu, 100) : null,
      memBytes: b ? accMean(b.mem, 1) : null,
    });
  }
  return out;
}

/**
 * Server-side downsampled read for the /api/telemetry/history route. Loads only
 * the daily files the range actually spans (via the mtime-keyed cache above),
 * averages into <=360 buckets, and reports the oldest available sample
 * regardless of the requested range so the UI can render an honest "recording
 * since" caption even when the range asked for is wider than what exists.
 */
export async function queryMetricsHistory(range: HistoryRange, containerNames: string[], summary?: SummaryMetric): Promise<HistoryQueryWithSummary> {
  const now = Date.now();
  const rangeMs = RANGE_MS[range];
  const startTs = now - rangeMs;
  const widthMs = bucketWidthMs(rangeMs);

  const since = await recordingSince();

  const dates = new Set<string>();
  for (let t = startTs; t <= now; t += 24 * 60 * 60 * 1000) dates.add(dateKey(t));
  dates.add(dateKey(now));

  const filesByDate = new Map(listHistoryFilesSync().map((f) => [f.date, f.path]));
  const allSamples: MetricsHistorySample[] = [];
  for (const date of dates) {
    const filePath = filesByDate.get(date);
    if (!filePath) continue;
    const samples = await readFileCached(filePath);
    for (const s of samples) allSamples.push(s);
  }

  const host = downsampleHost(allSamples, startTs, now, widthMs);
  const containers: Record<string, HistoryBucket[]> = {};
  for (const name of containerNames.slice(0, 4)) {
    containers[name] = downsampleContainer(allSamples, name, startTs, now, widthMs);
  }

  return attachSummary({ recordingSince: since, host, containers }, allSamples, startTs, now, widthMs, summary);
}

/* -----------------------------------------------------------------------
 * Mount-capacity growth reader (G5's DISK-tab growth panel). Purely
 * additive: a second read/downsample path over the SAME daily JSONL files
 * and mtime-keyed file cache queryMetricsHistory above already maintains —
 * this does not touch the sampler (writeSample already records `mounts` on
 * every tick, ahead of this reader existing, exactly so this data would be
 * accumulating by the time it was needed) or any of queryMetricsHistory's
 * own types, only reuses its private file-reading helpers.
 * --------------------------------------------------------------------- */

export type GrowthRange = "24h" | "7d" | "14d";

const GROWTH_RANGE_MS: Record<GrowthRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
};

export interface MountHistoryBucket {
  t: number;
  usedBytes: number | null;
}

export interface MountGrowthResult {
  /** Same meaning as HistoryQueryResult.recordingSince — oldest sample across
   *  ALL retained history, not just this range, so the UI can render an
   *  honest "recording since" caption before a full window exists. */
  recordingSince: number | null;
  mounts: Record<string, MountHistoryBucket[]>;
}

function downsampleMount(
  samples: MountSample[],
  mount: string,
  startTs: number,
  endTs: number,
  widthMs: number,
): MountHistoryBucket[] {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    if (s.t < startTs || s.t > endTs) continue;
    const used = s.mounts?.[mount]; // "constructor" must not resolve to Object.prototype's
    if (typeof used !== "number") continue;
    const key = Math.floor(s.t / widthMs) * widthMs;
    let b = buckets.get(key);
    if (!b) {
      b = { sum: 0, n: 0 };
      buckets.set(key, b);
    }
    b.sum += used;
    b.n++;
  }
  const first = Math.floor(startTs / widthMs) * widthMs;
  const last = Math.floor(endTs / widthMs) * widthMs;
  const out: MountHistoryBucket[] = [];
  for (let t = first; t <= last; t += widthMs) {
    const b = buckets.get(t);
    // A bucket with no samples is a real gap (null), never interpolated —
    // same Hatch-Not-Empty reasoning emitBuckets documents above.
    out.push({ t, usedBytes: b ? Math.round(b.sum / b.n) : null });
  }
  return out;
}

/**
 * Server-side downsampled read for /api/resources/growth: per-mount
 * used-bytes series over `range`, for the DISK tab's mount-capacity-over-time
 * chart. `mountpoints` is caller-supplied (the client already has the live
 * mount list from /api/resources — see resources/page.tsx) rather than
 * discovered here, so this never has to guess which mount names have history.
 */
export async function queryMountHistory(range: GrowthRange, mountpoints: string[]): Promise<MountGrowthResult> {
  const now = Date.now();
  const rangeMs = GROWTH_RANGE_MS[range];
  const startTs = now - rangeMs;
  const widthMs = bucketWidthMs(rangeMs);

  const since = await recordingSince();

  const dates = new Set<string>();
  for (let t = startTs; t <= now; t += 24 * 60 * 60 * 1000) dates.add(dateKey(t));
  dates.add(dateKey(now));

  const filesByDate = new Map(listHistoryFilesSync().map((f) => [f.date, f.path]));
  const allSamples: MountSample[] = [];
  for (const date of dates) {
    const filePath = filesByDate.get(date);
    if (!filePath) continue;
    const samples = await readMountsCached(filePath);
    for (const s of samples) allSamples.push(s);
  }

  const mounts: Record<string, MountHistoryBucket[]> = {};
  for (const mount of mountpoints.slice(0, 8)) {
    mounts[mount] = downsampleMount(allSamples, mount, startTs, now, widthMs);
  }

  return { recordingSince: since, mounts };
}
