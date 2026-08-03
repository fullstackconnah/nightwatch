"use client";

/** Not a `.dot-*` variant on purpose — those states (running/unhealthy/dead…)
 *  describe container health, and a fifth "stale" meaning would have to be
 *  invented and taught. This is plain warn-tinted text, earned by a real
 *  threshold (the fetch is confirmed unreachable), not decoration.
 *
 *  Shared by every kiosk surface that can be showing a last-known-good
 *  reading instead of a fresh one (weather, vitals/health, Home Assistant
 *  state) — one visual marker for "this is old," not a different one per
 *  screen. */
export function StaleTag() {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[0.65rem] text-warn">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />
      stale
    </span>
  );
}
