/** Most remote-peer rows /api/network sends; the rest are counted in `truncated`. */
export const CONNECTIONS_MAX = 200;

/** `sorted` must already be ordered busiest-first. */
export function capConnections<T extends { count: number }>(
  sorted: T[],
): { connections: T[]; truncated: number; truncatedConnections: number } {
  const dropped = sorted.slice(CONNECTIONS_MAX);
  return {
    connections: sorted.slice(0, CONNECTIONS_MAX),
    truncated: dropped.length,
    truncatedConnections: dropped.reduce((a, g) => a + g.count, 0),
  };
}
