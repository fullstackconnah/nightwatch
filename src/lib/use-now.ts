"use client";

import { useSyncExternalStore } from "react";

/**
 * One 1 Hz clock for the whole app.
 *
 * Uptime counters live on every container card, and 26 cards each owning a
 * setInterval is 26 timers and 26 independent re-render cascades a second. This
 * is a single module-level timer that every subscriber shares, started on the
 * first subscription and cleared on the last — so when nothing on screen needs
 * second resolution, no timer runs at all.
 *
 * `live = false` is the common case, not an optimisation afterthought: a card
 * showing "4d 6h" changes once an hour, and the container poll re-renders it
 * every 5s regardless, so it needs the current second but not a timer to push
 * it. Only sub-minute spans, where the seconds digit is actually moving,
 * subscribe.
 */

const TICK_MS = 1000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === null) {
    timer = setInterval(() => {
      for (const listener of listeners) listener();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** No timer, no notifications — the value then only moves when the caller re-renders. */
function subscribeIdle(): () => void {
  return () => {};
}

/**
 * Quantised to whole seconds on purpose. useSyncExternalStore compares the
 * snapshot before and after rendering and treats a value that keeps changing as
 * an infinite loop, so a raw Date.now() here would warn (and, with a subscriber
 * attached, spin). Whole seconds are also the finest granularity anything
 * displays.
 */
function getSnapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

/** There is no "now" that survives to hydration; callers treat 0 as "not yet known". */
function getServerSnapshot(): number {
  return 0;
}

export function useNow(live: boolean): number {
  return useSyncExternalStore(live ? subscribe : subscribeIdle, getSnapshot, getServerSnapshot);
}

/** Below this, the displayed value changes every second and needs the shared timer. */
export const TICKING_THRESHOLD_MS = 60_000;
