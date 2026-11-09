// Pure helpers for metrics-history.ts (kept apart so node:test can load them without the @/ alias).

/** Skip a tick only while the clock is inside the interval after the last write; a clock that went backwards writes. */
export const shouldSkipTick = (ts: number, last: number, intervalMs: number): boolean =>
  ts >= last && ts - last < intervalMs;

/** Bucket width: at least 2x the sample interval so tick jitter never leaves an empty bucket. */
export const bucketWidthMs = (rangeMs: number, intervalMs: number, maxPoints: number): number =>
  Math.max(2 * intervalMs, Math.ceil(rangeMs / maxPoints));

/** Running mean that ignores null and non-finite values; no valid value is a gap (null), never 0. */
export interface Acc { sum: number; n: number }
export const accAdd = (a: Acc, v: number | null | undefined): void => {
  if (typeof v === "number" && Number.isFinite(v)) { a.sum += v; a.n++; }
};
export const accMean = (a: Acc, scale: number): number | null =>
  a.n > 0 ? Math.round((a.sum / a.n) * scale) / scale : null;

export function mean(values: (number | null)[]): number | null {
  const a: Acc = { sum: 0, n: 0 };
  for (const v of values) accAdd(a, v);
  return accMean(a, 1);
}
