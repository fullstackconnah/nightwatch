/** Import-free leaf (node:test cannot resolve `@/` or touch node:fs): the Timeline's
 *  per-container range summary over history samples. Used by metrics-history.ts. */

export interface SummarySample {
  t: number;
  cpu: number;
  memUsed: number;
  /** name -> [cpuPct, memBytes, ...] (positional tuple, see MetricsHistoryContainerTuple) */
  containers: Record<string, number[]>;
}

export type SummaryMetric = "cpu" | "mem";

export interface ContainerSummary {
  avg: number;
  peak: number;
  spark: (number | null)[];
}

export interface SummaryResult {
  containersTotal: (number | null)[];
  summary: Record<string, ContainerSummary>;
}

export function parseSummary(v: string | null): SummaryMetric | undefined {
  return v === "cpu" || v === "mem" ? v : undefined;
}

/** Cpu keeps 2 decimals, memory whole bytes: same rounding as emitBuckets. */
const round = (metric: SummaryMetric, v: number) => (metric === "cpu" ? Math.round(v * 100) / 100 : Math.round(v));

/**
 * One pass over `samples`. `containersTotal` uses the same epoch-aligned buckets as the
 * host series (null = no sample in the bucket, a real gap). Per container: `avg` and
 * `peak` over the window's readings where it was present, and a `points`-bin spark
 * across [startTs, endTs] where a bin with no reading is null, never 0.
 * Allocates per call: two typed arrays of one entry per bucket, per container one
 * object with two Float64Array(points) and one Int32Array(points), plus the output.
 */
export function summarizeContainers(
  samples: SummarySample[],
  startTs: number,
  endTs: number,
  widthMs: number,
  metric: SummaryMetric,
  points: number,
): SummaryResult {
  const idx = metric === "cpu" ? 0 : 1;
  const firstKey = Math.floor(startTs / widthMs);
  const nBuckets = Math.floor(endTs / widthMs) - firstKey + 1;
  const totSum = new Float64Array(nBuckets);
  const totN = new Int32Array(nBuckets);
  const binW = (endTs - startTs) / points;
  const per = new Map<string, { sum: number; n: number; peak: number; bSum: Float64Array; bN: Int32Array }>();

  for (const s of samples) {
    if (s.t < startTs || s.t > endTs) continue;
    const bi = Math.floor(s.t / widthMs) - firstKey;
    const si = binW > 0 ? Math.min(points - 1, Math.floor((s.t - startTs) / binW)) : 0; // binW 0 when start === end
    totN[bi]++;
    for (const name in s.containers) {
      const v = s.containers[name][idx];
      totSum[bi] += v;
      let c = per.get(name);
      if (!c) {
        c = { sum: 0, n: 0, peak: v, bSum: new Float64Array(points), bN: new Int32Array(points) };
        per.set(name, c);
      }
      c.sum += v;
      c.n++;
      if (v > c.peak) c.peak = v;
      c.bSum[si] += v;
      c.bN[si]++;
    }
  }

  const containersTotal: (number | null)[] = [];
  for (let i = 0; i < nBuckets; i++) containersTotal.push(totN[i] ? round(metric, totSum[i] / totN[i]) : null);

  const summary: Record<string, ContainerSummary> = {};
  for (const [name, c] of per) {
    const spark: (number | null)[] = [];
    for (let i = 0; i < points; i++) spark.push(c.bN[i] ? round(metric, c.bSum[i] / c.bN[i]) : null);
    summary[name] = { avg: round(metric, c.sum / c.n), peak: round(metric, c.peak), spark };
  }
  return { containersTotal, summary };
}

/** Builds the history response: returned untouched unless a summary metric was asked
 *  for, so the default shape stays exactly recordingSince, host, containers. */
export function attachSummary<T extends object>(
  base: T,
  samples: SummarySample[],
  startTs: number,
  endTs: number,
  widthMs: number,
  metric: SummaryMetric | undefined,
): T | (T & SummaryResult) {
  if (!metric) return base;
  return { ...base, ...summarizeContainers(samples, startTs, endTs, widthMs, metric, 48) };
}
