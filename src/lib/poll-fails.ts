/** Consecutive failed stats polls after which the numbers are dropped instead of frozen. */
export const STATS_STALE_AFTER = 2;

export function nextFailCount(ok: boolean, n: number): number {
  return ok ? 0 : n + 1;
}
