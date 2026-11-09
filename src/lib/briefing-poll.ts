export const BRIEFING_POLL_MS = 10_000;
// Content landing is not the end: the server rolls its per-day cache itself,
// so a slow poll lets a wall display pick up tomorrow's digest.
export const BRIEFING_SETTLED_MS = 30 * 60_000;

export function briefingRefreshMs(latest?: { status: string; digest?: unknown; news?: unknown }): number {
  if (!latest) return BRIEFING_POLL_MS;
  if (latest.status === "ok" && !latest.digest && !latest.news) return BRIEFING_POLL_MS;
  return BRIEFING_SETTLED_MS;
}
