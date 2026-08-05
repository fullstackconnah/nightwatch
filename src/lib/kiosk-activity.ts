"use client";

import { useSyncExternalStore } from "react";
import { computePeriod } from "@/components/kiosk-display";

/**
 * A shared idle/night signal for every poll on /kiosk that backs off.
 *
 * This is a wall tablet that runs 24/7, and a prior perf pass found no idle
 * or night backoff anywhere: every poll ran at full rate all night. Fixing
 * that per-component would mean N components each owning a pointerdown/
 * keydown listener and its own "am I idle" timer — exactly the "26 timers, 26
 * independent re-render cascades" shape src/lib/use-now.ts already tore out
 * once for the per-second clock. This module applies the same fix to idle
 * detection: ONE document-level listener pair and ONE shared re-check timer
 * for the whole app, started on the first subscriber and cleared on the
 * last, regardless of how many components call useKioskIdle() below.
 *
 * useKioskNight() rides the same shared timer for its periodic re-check, but
 * derives the night WINDOW from kiosk-display.tsx's own computePeriod rather
 * than restating "22:00-05:00" as a second literal — see the export comment
 * there. That is the one cross-file dependency this module has, and it is
 * intentional: the poll backoff and the night overlay must never disagree
 * about what "night" means.
 */

const ACTIVITY_EVENTS = ["pointerdown", "keydown"] as const;

/** How often the shared timer re-checks idle/night state. Coarser than
 *  use-now.ts's 1s clock on purpose: the idle tiers below are 20s+ apart, so
 *  a few seconds of slop in NOTICING idle costs nothing, and a 5s tick means
 *  5x fewer wakeups than piggybacking on a 1Hz timer would cost. Becoming
 *  ACTIVE again does not wait on this timer at all — see markActivity below,
 *  which notifies subscribers synchronously on the triggering event. */
const IDLE_CHECK_MS = 5000;

/** Shared idle threshold for every backed-off poll on this surface. One
 *  constant rather than a per-component choice so "idle" means the same
 *  wall-clock gap everywhere — a poll backing off after 30s while its
 *  neighbour waits 3 minutes would make the screen feel inconsistently
 *  responsive depending on which panel happened to notice the touch. */
export const KIOSK_IDLE_AFTER_MS = 2 * 60_000;

let lastActivityAt = typeof Date !== "undefined" ? Date.now() : 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let listenersAttached = false;

function notify() {
  for (const listener of listeners) listener();
}

function markActivity() {
  lastActivityAt = Date.now();
  notify(); // immediate — the restore-to-full-rate path must not wait for IDLE_CHECK_MS
}

function attachActivityListeners() {
  if (listenersAttached || typeof document === "undefined") return;
  listenersAttached = true;
  for (const evt of ACTIVITY_EVENTS) document.addEventListener(evt, markActivity, { passive: true });
}

function detachActivityListeners() {
  if (!listenersAttached) return;
  listenersAttached = false;
  for (const evt of ACTIVITY_EVENTS) document.removeEventListener(evt, markActivity);
}

/** Shared by both useKioskIdle and useKioskNight below — neither cares WHY
 *  it was asked to recompute, only that it gets a chance to, on activity and
 *  on the coarse timer alike. */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  attachActivityListeners();
  if (timer === null) {
    timer = setInterval(notify, IDLE_CHECK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      detachActivityListeners();
    }
  };
}

/**
 * True once `idleAfterMs` has elapsed since the last pointerdown/keydown
 * anywhere in the document. Backed by the single shared listener+timer pair
 * above, not a per-call subscription of its own — calling this from five
 * different polls costs one document listener pair and one timer, not five.
 *
 * SSR/first-paint snapshot is always `false` ("active"), matching use-now.ts's
 * "0 means not yet known" shape: a server has no user touching a screen, and
 * seeding "idle" would mean every poll opens at its slowest tier for the
 * first render before snapping to reality, which is backwards — a tablet
 * that just loaded is the least idle it will ever be.
 */
export function useKioskIdle(idleAfterMs: number): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Date.now() - lastActivityAt >= idleAfterMs,
    () => false,
  );
}

/**
 * True during the 22:00-05:00 window kiosk-display.tsx's computePeriod
 * already defines for the night overlay. Reuses that function directly
 * rather than a second copy of the hour range, so the poll backoff and the
 * night overlay can never disagree about what "night" means.
 *
 * SSR/first-paint snapshot is `false` ("day") for the same reason
 * useKioskPeriod itself seeds "day" before its first effect runs — a server
 * has no reliable claim to this device's local clock.
 */
export function useKioskNight(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => computePeriod(new Date()) === "night",
    () => false,
  );
}

/**
 * Turns one poll's full-rate interval into the effective one for right now:
 * full rate while the screen is in use, backed off once idle, backed off
 * further overnight. Night takes priority over idle rather than the two
 * combining — of course nobody has touched the screen at 3am, so treating
 * them as independent tiers to add together would just be a longer way of
 * writing the night tier.
 */
export function kioskEffectiveInterval(tiers: {
  active: number;
  idle: number;
  night: number;
  isIdle: boolean;
  isNight: boolean;
}): number {
  if (tiers.isNight) return tiers.night;
  if (tiers.isIdle) return tiers.idle;
  return tiers.active;
}
