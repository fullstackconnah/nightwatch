/** Pure cadence decisions for the telemetry loop in telemetry.ts, kept free of timers and imports so they test directly. */

/** What this iteration does, given who is listening now and whether the previous iteration had listeners. */
export function loopStep(a: { subscribers: number; wasLive: boolean }) {
  const live = a.subscribers > 0;
  return {
    feedRing: live, // idle ticks only feed the history file; the 60 s ring is live-only
    resetRates: live && !a.wasLive, // first live tick is a cold start, never a rate averaged over the idle gap
    clearRing: !live && a.wasLive, // a new tab must not get 30 s-spaced points presented as the last minute
  };
}

/** Sleep after a tick. Idle waits the full interval (not minus elapsed) so two history timestamps are never under it apart and skipped. */
export function nextDelayMs(a: { subscribers: number; elapsedMs: number; liveMs: number; idleMs: number }): number {
  return a.subscribers > 0 ? Math.max(0, a.liveMs - a.elapsedMs) : a.idleMs;
}
