/**
 * Go live on an SSE stream: subscribe, then start the heartbeat. A failed enqueue inside
 * `subscribe` tears the stream down (closed = true) before this returns; by then the
 * teardown has already run and cannot see what was just created, so undo it here.
 */
export function goLive(
  isClosed: () => boolean,
  subscribe: () => (() => void)[],
  ping: () => void,
  heartbeatMs: number,
): { unsubscribe: () => void; timer: ReturnType<typeof setInterval> } | null {
  const subs = subscribe();
  const unsubscribe = () => {
    for (const u of subs) u();
  };
  if (isClosed()) {
    unsubscribe();
    return null;
  }
  return { unsubscribe, timer: setInterval(ping, heartbeatMs) };
}
