// Pure point math for components/charts.tsx Sparkline. Relative imports only, so node:test can load this file.
import type { TelemetryRow, TelemetrySample } from "./types/telemetry.ts";

/** Polyline and area points for a W x H box, or null (show "collecting…") when fewer than 2 samples are finite.
 *  A `max` that is not a positive finite number falls back to the data peak, as an undefined `max` does. */
export function sparkPaths(data: number[], max: number | undefined, W: number, H: number) {
  const vals = data.filter(Number.isFinite);
  if (vals.length < 2) return null;
  const peak = max !== undefined && Number.isFinite(max) && max > 0 ? max : Math.max(...vals, 1);
  const line = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      const y = H - 3 - (Math.min(v, peak) / peak) * (H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return { line, area: `0,${H} ${line} ${W},${H}` };
}

export type TelemetryMetric = "cpu" | "mem" | "net" | "blkio";

function telemetryMetricValue(row: TelemetryRow, metric: TelemetryMetric): number {
  switch (metric) {
    case "cpu":
      return row.cpuPct;
    case "mem":
      return row.memBytes;
    case "net":
      return row.rxRate + row.txRate;
    case "blkio":
      return row.blkReadRate + row.blkWriteRate;
  }
}

/**
 * Maps each sample to one container's value for `metric`, keeping the series length equal to
 * `samples.length` so a sparkline's x-axis stays time-aligned across containers. A sample with no
 * row for the container (not yet running) or a non-finite value is NaN: the gap marker, never 0.
 */
export function seriesFor(samples: TelemetrySample[], containerId: string, metric: TelemetryMetric): number[] {
  return samples.map((sample) => {
    const row = sample.containers[containerId];
    const value = row ? telemetryMetricValue(row, metric) : NaN;
    return Number.isFinite(value) ? value : NaN; // Infinity is a bad sample too
  });
}

/** Mean of the finite samples; null when there is none (callers show their no-data text). */
export function finiteMean(a: readonly number[]): number | null {
  const v = a.filter(Number.isFinite);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
}

/** Peak of the finite samples, floored at 0 (a series with no finite sample peaks at 0). */
export function finitePeak(a: readonly number[]): number {
  return Math.max(0, ...a.filter(Number.isFinite));
}

/** Stroked line and fill for Sparkline. Each run of consecutive finite samples is its own sub-path,
 *  x stays indexed by the original sample position, and a lone sample is a zero-length segment
 *  (a dot under round caps). Null when no sample is finite. */
export function gapPaths(samples: readonly number[], width: number, height: number, yMax: number) {
  if (!samples.some(Number.isFinite)) return null;
  const values = samples.length === 1 ? [samples[0], samples[0]] : samples; // one sample: flat, full width
  const pt = (i: number) => `${(i / (values.length - 1)) * width},${height - (values[i] / yMax) * height}`;
  const runs: number[][] = [];
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    if (i > 0 && Number.isFinite(values[i - 1])) runs[runs.length - 1].push(i);
    else runs.push([i]);
  });
  const segs = runs.map((r) => (r.length === 1 ? [r[0], r[0]] : r)); // lone sample: zero-length segment
  const line = segs.map((r) => `M${pt(r[0])} ${r.slice(1).map((i) => `L${pt(i)}`).join(" ")}`).join(" ");
  const x = (i: number) => (i / (values.length - 1)) * width;
  const area = segs
    .map((r) => `M${x(r[0])},${height} ${r.map((i) => `L${pt(i)}`).join(" ")} L${x(r[r.length - 1])},${height} Z`)
    .join(" ");
  return { line, area };
}
