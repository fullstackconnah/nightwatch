import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { listContainers } from "@/lib/docker";

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

const SAMPLE_INTERVAL_MS = 30_000;
const RETENTION_DAYS = 14;
const MAX_POINTS = 360;

/** One line of the JSONL history file. Container values are a positional tuple
 *  (not an object) to keep the on-disk format compact — 14 days of ~2880
 *  samples/day across ~26 containers adds up. */
export type MetricsHistoryContainerTuple = [cpuPct: number, memBytes: number, rxBps: number, txBps: number];

export interface MetricsHistorySample {
  t: number;
  cpu: number;
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

const RANGE_MS: Record<HistoryRange, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

interface FileCacheEntry {
  mtimeMs: number;
  samples: MetricsHistorySample[];
}

const globalForHistory = globalThis as unknown as {
  __metricsHistoryLastSampleTs?: number;
  __metricsHistoryLastPrunedDate?: string;
  __metricsHistoryWarned?: Set<string>;
  __metricsHistoryFileCache?: Map<string, FileCacheEntry>;
};

function warnedSet(): Set<string> {
  if (!globalForHistory.__metricsHistoryWarned) globalForHistory.__metricsHistoryWarned = new Set();
  return globalForHistory.__metricsHistoryWarned;
}

/** Logs a failure exactly once per distinct reason, then swallows it forever —
 *  history must degrade silently, and a dashboard that re-warns every 30s about
 *  an unwritable volume is just noise nobody reads. */
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
      Math.round(row.cpuPct * 10) / 10,
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
    cpu: Math.round(input.host.cpuPct * 10) / 10,
    memUsed: Math.round(input.host.memUsed),
    memTotal: Math.round(input.host.memTotal),
    mounts,
    containers,
  };

  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.appendFile(filePathForDate(date), JSON.stringify(sample) + "\n", "utf8");
  } catch (err) {
    warnOnce("write failed — history dir unwritable", err);
    return;
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
  if (input.ts - last < SAMPLE_INTERVAL_MS) return;
  // Set before the write resolves — a slow write must not cause a second tick to
  // pile on another write once the interval has merely nearly elapsed.
  globalForHistory.__metricsHistoryLastSampleTs = input.ts;
  void writeSample(input).catch((err) => warnOnce("sample write threw", err));
}

/** Parses one JSONL file, using a globalThis cache keyed by path + mtime so a
 *  7-day query (up to 8 files) doesn't re-read and re-parse every file on every
 *  ~30s poll — only files that changed since the last read are touched. */
async function readFileCached(filePath: string): Promise<MetricsHistorySample[]> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return [];
  }
  const cache = fileCache();
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.samples;

  let text: string;
  try {
    text = await fsp.readFile(filePath, "utf8");
  } catch (err) {
    warnOnce("read failed", err);
    return cached?.samples ?? [];
  }

  const samples: MetricsHistorySample[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      samples.push(JSON.parse(line) as MetricsHistorySample);
    } catch {
      // One corrupt line (e.g. a torn write mid-append) must not invalidate the
      // rest of the day's file.
    }
  }
  cache.set(filePath, { mtimeMs: stat.mtimeMs, samples });
  return samples;
}

/** Oldest sample timestamp across every retained file — read from the oldest
 *  file's first line only (not a full scan), so this stays cheap. */
async function recordingSince(): Promise<number | null> {
  const files = listHistoryFilesSync();
  if (files.length === 0) return null;
  const samples = await readFileCached(files[0].path);
  return samples.length > 0 ? samples[0].t : null;
}

function bucketWidthMs(rangeMs: number): number {
  return Math.max(SAMPLE_INTERVAL_MS, Math.ceil(rangeMs / MAX_POINTS));
}

/** Averages samples into fixed-width, epoch-aligned buckets across [startTs,
 *  endTs]. A bucket with no samples in it is emitted as a null-valued point — a
 *  real gap, never interpolated across from its neighbours (Hatch-Not-Empty
 *  rule: an absent measurement must not be drawn as if it were measured). */
function downsampleHost(samples: MetricsHistorySample[], startTs: number, endTs: number, widthMs: number): HistoryBucket[] {
  const buckets = new Map<number, { cpuSum: number; cpuN: number; memSum: number; memN: number }>();
  for (const s of samples) {
    if (s.t < startTs || s.t > endTs) continue;
    const key = Math.floor(s.t / widthMs) * widthMs;
    let b = buckets.get(key);
    if (!b) {
      b = { cpuSum: 0, cpuN: 0, memSum: 0, memN: 0 };
      buckets.set(key, b);
    }
    b.cpuSum += s.cpu;
    b.cpuN++;
    b.memSum += s.memUsed;
    b.memN++;
  }
  return emitBuckets(buckets, startTs, endTs, widthMs);
}

function downsampleContainer(samples: MetricsHistorySample[], name: string, startTs: number, endTs: number, widthMs: number): HistoryBucket[] {
  const buckets = new Map<number, { cpuSum: number; cpuN: number; memSum: number; memN: number }>();
  for (const s of samples) {
    if (s.t < startTs || s.t > endTs) continue;
    const row = s.containers[name];
    if (!row) continue;
    const key = Math.floor(s.t / widthMs) * widthMs;
    let b = buckets.get(key);
    if (!b) {
      b = { cpuSum: 0, cpuN: 0, memSum: 0, memN: 0 };
      buckets.set(key, b);
    }
    b.cpuSum += row[0];
    b.cpuN++;
    b.memSum += row[1];
    b.memN++;
  }
  return emitBuckets(buckets, startTs, endTs, widthMs);
}

function emitBuckets(
  buckets: Map<number, { cpuSum: number; cpuN: number; memSum: number; memN: number }>,
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
      cpuPct: b ? Math.round((b.cpuSum / b.cpuN) * 10) / 10 : null,
      memBytes: b ? Math.round(b.memSum / b.memN) : null,
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
export async function queryMetricsHistory(range: HistoryRange, containerNames: string[]): Promise<HistoryQueryResult> {
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

  return { recordingSince: since, host, containers };
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
  samples: MetricsHistorySample[],
  mount: string,
  startTs: number,
  endTs: number,
  widthMs: number,
): MountHistoryBucket[] {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    if (s.t < startTs || s.t > endTs) continue;
    const used = s.mounts[mount];
    if (used == null) continue;
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
  const allSamples: MetricsHistorySample[] = [];
  for (const date of dates) {
    const filePath = filesByDate.get(date);
    if (!filePath) continue;
    const samples = await readFileCached(filePath);
    for (const s of samples) allSamples.push(s);
  }

  const mounts: Record<string, MountHistoryBucket[]> = {};
  for (const mount of mountpoints.slice(0, 8)) {
    mounts[mount] = downsampleMount(allSamples, mount, startTs, now, widthMs);
  }

  return { recordingSince: since, mounts };
}
