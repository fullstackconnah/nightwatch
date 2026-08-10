"use client";

/**
 * The optimistic-hold state machines behind the kiosk climate tile, extracted
 * from kiosk-climate.tsx (which was 1709 lines and carried these two hooks,
 * the tile, the modal, a slider and four sub-components in one file).
 *
 * Nothing here renders. Both hooks exist for the same reason: Home Assistant
 * confirms a write on its own schedule (an IR blaster may take seconds), so a
 * tile that simply mirrored HA's state would visibly snap back after every tap.
 * Each hook holds the value the owner asked for, re-checks HA after a delay,
 * and gives up after a TTL rather than fighting HA forever.
 */

import { useEffect, useRef, useState } from "react";
import type { HaClimate } from "@/lib/types/ha";
import type { UseKioskHaResult } from "@/components/kiosk/kiosk-hub";

/** Setpoint step per nudge tap. Half a degree is HA's own common granularity
 *  and the smallest change worth a round-trip. */
export const NUDGE_STEP = 0.5;

/** Which mode "on" means for a given unit.
 *
 *  Home Assistant has no generic "turn on" for climate — every unit exposes
 *  its own `hvac_modes`, and picking the wrong one is the difference between
 *  heating a room and air-conditioning it. Preference order runs from the most
 *  self-managing to the most specific: `heat_cool`/`auto` let the unit decide,
 *  which is what someone pressing a bare power button almost always wants;
 *  `heat` and `cool` are only reached when the unit can't. Falls back to the
 *  first non-off mode it advertises rather than guessing a name that might not
 *  exist on this unit. */
export function preferredOnMode(modes: string[]): string | null {
  for (const wanted of ["heat_cool", "auto", "heat", "cool"]) {
    if (modes.includes(wanted)) return wanted;
  }
  return modes.find((m) => m !== "off") ?? null;
}

/* ── last-used mode memory (2026-08-04) ─────────────────────────────────────
   The power button used to always guess via preferredOnMode, which for this
   house's units lands on "auto" (they expose heat_cool/auto/heat/cool but not
   heat_cool as truly dual — see types/ha.ts). The owner wants power-on to
   instead resume whatever mode the unit was actually last running in,
   including a mode set from the AC's own remote or the HA app rather than
   from this tile — so the write happens from an effect watching the OBSERVED
   hvacMode, not from setMode's call site. */

export const LAST_MODE_STORAGE_KEY = "kiosk-climate-last-mode";

export type LastModeMap = Record<string, string>;

/** Defensive parse, same idiom as kiosk-theme.tsx's stored-theme read: a
 *  missing key, invalid JSON, or a corrupt/wrong-shaped blob all degrade to
 *  "nothing remembered" rather than throwing and bricking the tile. */
export function readLastModes(): LastModeMap {
  try {
    const raw = window.localStorage.getItem(LAST_MODE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LastModeMap = {};
    for (const [entityId, mode] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof mode === "string") out[entityId] = mode;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist one entity's last-seen non-off mode. Storage failures (private
 *  mode, quota) are swallowed exactly like setKioskTheme's write — the
 *  memory just won't survive a reload, which is not worth surfacing an error
 *  over. */
export function writeLastMode(entityId: string, mode: string): void {
  try {
    const current = readLastModes();
    current[entityId] = mode;
    window.localStorage.setItem(LAST_MODE_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // non-persistent is fine
  }
}

/* ── target-temperature hold (2026-08-04 fix) ───────────────────────────────
   THE BUG: kiosk-hub.tsx's runAction (shared plumbing this file cannot edit)
   revalidates unconditionally the instant the POST to HA resolves — its
   `finally { void mutate(); }` has no knowledge of what kind of device it
   just wrote to. HA's REST call returns success immediately, but these are
   IR/WiFi AC units that take real seconds to actually report the new
   `temperature` attribute back through /api/states. The revalidate therefore
   fetches the OLD value and stomps this tile's own optimistic update — which
   is why a tap appeared to do nothing until the NEXT tap made the previous
   one visible. Compounding it, the old nudge_temp action reads HA's current
   value server-side and adds a delta, so two rapid taps could both read the
   pre-tap value and silently lose a step.

   THE FIX: this hook holds the tapped target locally, independent of
   whatever kiosk-hub's SWR cache says, until either HA visibly reports back
   the SAME number (proof the write took) or a TTL elapses (proof it didn't,
   or is just unusually slow — at which point we stop showing a number that
   was never confirmed and fall back to HA's real value). It also switches to
   the ABSOLUTE set_temp action (see types/ha.ts) and debounces the write, so
   N rapid taps produce exactly one HA request carrying the fully-accumulated
   value instead of N races. This hold has to live here, in the tile's own
   hook, because kiosk-hub.tsx's fetch/mutate/optimistic-write plumbing is
   out of bounds for this change and is shared by every other control on the
   panel — it cannot special-case one entity's timing.

   REGRESSION FOUND ON THE TEST STACK (2026-08-04) AND WHY: this hook
   originally called `ha.runAction(request, next)`, passing an optimistic
   HaEntities snapshot the same way setMode/nudge do — reusing the pattern
   without noticing what it does to THIS hook's own release condition.
   runAction applies that snapshot to the SWR cache immediately (before the
   HA round-trip even finishes), which means climate.targetTemp became
   `value` within the same tick the debounced write fired — long before HA
   itself had actually moved. The release effect below then saw
   climate.targetTemp === pendingTarget and concluded "HA confirmed it",
   clearing the hold. Moments later runAction's own `finally { void mutate()
   }` refetched HA's REAL (still-stale) state, overwrote climate.targetTemp
   back to the old value, and — with the hold already gone — displayTarget
   fell straight back to it. Measured on real hardware: correct at 154ms,
   reverted at 619ms, HA's genuine value only landing at 7.6s. The fix is to
   never let this hook's own write touch climate.targetTemp before HA
   genuinely reports it — see commit() below, which intentionally passes NO
   optimistic snapshot. `pendingTarget` is already this hook's entire
   optimistic display; climate.targetTemp must stay 100% server-truth or the
   release effect's comparison is meaningless. (Checked every other reader of
   entities.climates: kiosk-hub.tsx's ClimateSection just re-maps it to
   KioskClimateTile instances — i.e. this tile and its siblings, whose other
   fields this write never touched anyway — and /smarthome's ha-climate.tsx
   reads an entirely separate SWR cache from its own useHa(), never this
   one. Nothing else depended on the snapshot this removes.) */

/* ── mode holds (2026-08-05) ─────────────────────────────────────────────────
   THE REPORT: "the climate controls don't immediately update when updating the
   settings, they stick on the current setting before changing later."

   Exactly the failure useTargetControl was built for, on the other four
   attributes. Every mode setter handed `ha.runAction` an optimistic HaEntities
   snapshot, which SWR applies at once — so the tap DID look instant for a few
   hundred milliseconds. Then runAction's own `finally { void mutate() }`
   refetched, HA (an IR bridge that answers the REST call long before the unit
   reports back) still said the OLD mode, and the chip snapped back to it until
   some later poll happened to catch up. Watching that, the control looks like
   it ignored you and then changed its mind on its own.

   THE SHAPE OF THE FIX, as asked for: read HA normally; on a write, show the
   SELECTED value regardless of what HA is saying; then re-ask HA a few seconds
   later and stop overriding as soon as it agrees.

   The write deliberately passes NO optimistic snapshot. That is not an
   omission — it is the whole reason the release test below is meaningful. With
   a snapshot, `climate[attr]` becomes our own requested value within the same
   tick, "HA agrees" is true immediately, the hold releases, and the refetch
   half a second later puts the stale value back on screen with nothing left
   holding it. That precise sequence is documented in useTargetControl's
   comment (measured: correct at 154ms, reverted at 619ms, HA's own truth at
   7.6s) and it is the same trap here. `held` IS the optimism; `climate[attr]`
   must stay server-truth. */

/** When to re-ask HA after a write — the owner's number. Long enough for an IR
 *  unit to have actually reported back, short enough that the hold isn't
 *  carrying the display for a noticeable stretch. Asked again at each multiple
 *  until the hold expires, because one unit answered at 7.6s in an earlier
 *  measurement and a single 5s probe would have missed it. */
export const MODE_RECHECK_MS = 5_000;
/** Stop overriding HA after this, agreement or not. A hold that never expires
 *  would show a value the unit rejected (an hvac mode the integration dropped,
 *  a fan level a firmware update removed) as if it had taken. Matches
 *  TARGET_HOLD_TTL_MS — same devices, same round trips. */
export const MODE_HOLD_TTL_MS = 20_000;

/** The four mode attributes this hold covers. Not the setpoint: that has its
 *  own hook (useTargetControl) with a debounce and an accumulating value, which
 *  these don't need — each of these is one absolute write per tap. */
export type ClimateModeAttr = "hvacMode" | "fanMode" | "presetMode" | "swingMode";

export interface ModeHolds {
  /** What to render for `attr`: the held selection while one is outstanding,
   *  otherwise HA's own value. */
  display: (attr: ClimateModeAttr) => string | undefined;
  /** Show `value` immediately, run `write`, then reconcile against HA. */
  select: (attr: ClimateModeAttr, value: string, write: () => void) => void;
}

export function useModeHolds(climate: HaClimate, ha: UseKioskHaResult): ModeHolds {
  const [held, setHeld] = useState<Partial<Record<ClimateModeAttr, string>>>({});
  /** One timer list per attribute, so selecting a fan level doesn't cancel the
   *  reconcile still running for a mode change made a second earlier. */
  const timersRef = useRef<Partial<Record<ClimateModeAttr, ReturnType<typeof setTimeout>[]>>>({});

  function clearTimers(attr: ClimateModeAttr) {
    for (const t of timersRef.current[attr] ?? []) clearTimeout(t);
    timersRef.current[attr] = [];
  }

  // Timers must not outlive the tile: the modal unmounting mid-reconcile must
  // not fire a revalidate or a setState afterwards.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const list of Object.values(timers)) for (const t of list ?? []) clearTimeout(t);
    };
  }, []);

  /* Release on agreement. Sound here only because `select` writes without an
     optimistic snapshot (see the block comment above), so the value this
     compares against is HA's and nobody else's. */
  useEffect(() => {
    setHeld((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const attr of Object.keys(prev) as ClimateModeAttr[]) {
        if (prev[attr] !== undefined && climate[attr] === prev[attr]) {
          delete next[attr];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [climate.hvacMode, climate.fanMode, climate.presetMode, climate.swingMode]);

  function select(attr: ClimateModeAttr, value: string, write: () => void) {
    clearTimers(attr);
    setHeld((prev) => ({ ...prev, [attr]: value }));
    write();
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Re-ask at 5s, 10s, 15s. The release effect above does the comparing —
    // these only make sure a fresh answer exists to compare against, rather
    // than waiting out the poll cadence (which backs off to 60s when idle and
    // would leave the hold expiring before HA was ever asked again).
    for (let t = MODE_RECHECK_MS; t < MODE_HOLD_TTL_MS; t += MODE_RECHECK_MS) {
      timers.push(setTimeout(() => ha.revalidate(), t));
    }
    timers.push(
      setTimeout(() => {
        setHeld((prev) => {
          if (prev[attr] === undefined) return prev;
          const next = { ...prev };
          delete next[attr];
          return next;
        });
      }, MODE_HOLD_TTL_MS),
    );
    timersRef.current[attr] = timers;
  }

  return {
    display: (attr) => held[attr] ?? climate[attr] ?? undefined,
    select,
  };
}

export const TARGET_WRITE_DEBOUNCE_MS = 500;
// 7.6s measured round-trip for one of these IR units to report a new
// setpoint with the unit already on; 10s left almost no margin, and a TTL
// that fires before HA catches up snaps the display backwards — the exact
// failure this hook exists to remove. Erring toward holding the user's own
// requested number too long is the safer direction.
export const TARGET_HOLD_TTL_MS = 20_000;
/** Float-noise tolerance when comparing the held target against what HA
 *  reports back — both sides are half-degree-stepped numbers, but IEEE float
 *  equality isn't safe to trust at face value. */
export const TARGET_EPSILON = 0.05;

/** How long the tile/modal stay in "adjusting" isolation after a nudge tap,
 *  reset on every tap so a run of them reads as one continuous interaction.
 *  Deliberately NOT TARGET_HOLD_TTL_MS (20s) below: that write hold can sit
 *  unresolved for the full 20 seconds if HA never confirms the value, and
 *  driving focus isolation off it would leave the OTHER tiles blurred for 20
 *  seconds after a single tap on this one — the nudge case the brief names
 *  needs the isolation to lift the moment a finger actually stops moving,
 *  not to wait out a round-trip that might not even be finished. */
export const FOCUS_HOLD_MS = 1200;

export interface TargetControl {
  /** What to render: the locally held pending write while one is in flight,
   *  otherwise HA's own targetTemp. Null exactly when targetTemp itself is
   *  (dual-setpoint units, or a unit reporting no target at all). */
  displayTarget: number | null;
  lowerDisabled: boolean;
  raiseDisabled: boolean;
  /** direction is ±1 "step" (the entity's own targetTempStep, or NUDGE_STEP
   *  when it doesn't advertise one) — never a raw degree delta, so this hook
   *  is the only place that needs to know the unit's step size. */
  bump: (direction: 1 | -1) => void;
  /** True for FOCUS_HOLD_MS after the most recent bump(), timer reset on
   *  each bump. Feeds the tile's onAdjustingChange and the modal's in-panel
   *  depth-of-field isolation — see FOCUS_HOLD_MS above for why this is a
   *  separate, much shorter signal than the write hold. */
  interacting: boolean;
  /** +1/-1 the direction displayTarget most recently moved, 0 if
   *  unknown/initial — feeds KioskDigitReel so the reel rolls the way the
   *  value actually went rather than guessing. Prefers the direction of the
   *  user's own bump() press (the truth about the gesture) and falls back to
   *  comparing displayTarget against its own previous value only for a
   *  change that arrives from HA rather than from a press. */
  reelDirection: 1 | -1 | 0;
}

/** Owns the displayed target for a SINGLE-setpoint climate tile — the only
 *  shape any unit in this house actually reports (targetTempLow/High are
 *  null on every one of them; see types/ha.ts). Dual-setpoint tiles keep
 *  using the pre-existing relative `nudge` below unchanged, per the owner's
 *  "leave it working, do not expand it" instruction — this hook is additive,
 *  not a replacement for that dead-but-functional path. */
/* Takes no `entities` snapshot: this hook writes an ABSOLUTE setpoint and
   owns the optimistic display itself, so it has no reason to build one. */
export function useTargetControl(climate: HaClimate, ha: UseKioskHaResult): TargetControl {
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttlRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const min = climate.minTemp ?? -Infinity;
  const max = climate.maxTemp ?? Infinity;
  const step = climate.targetTempStep ?? NUDGE_STEP;
  const displayTarget = pendingTarget ?? climate.targetTemp;

  // Adjusting isolation (Task B.3): a separate timer from the write hold
  // above, on purpose — see FOCUS_HOLD_MS's own comment.
  const [interacting, setInteracting] = useState(false);
  const interactingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reel direction (Task D.1): which way displayTarget last moved, for
  // KioskDigitReel. bumpDirectionRef carries the gesture's own truth from
  // bump() into the effect below the moment displayTarget actually changes,
  // then clears itself — an HA-originated change with no bump in between
  // finds the ref empty and falls through to inferring direction from the
  // sign of the change instead.
  const [reelDirection, setReelDirection] = useState<1 | -1 | 0>(0);
  const bumpDirectionRef = useRef<1 | -1 | null>(null);
  const prevDisplayRef = useRef<number | null>(displayTarget);

  function clearTimers() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (ttlRef.current) clearTimeout(ttlRef.current);
    debounceRef.current = null;
    ttlRef.current = null;
  }

  // Release the hold the instant HA's own reported value catches up to what
  // we asked for — the earliest point at which continuing to override it
  // would just be re-displaying the same number HA already agrees on.
  //
  // This test is only meaningful because `commit()` below deliberately does
  // NOT hand an optimistic snapshot to `ha.runAction`: `climate.targetTemp`
  // must carry SERVER-CONFIRMED data and nothing else, or the effect answers
  // its own question. It did exactly that once — passing the optimistic
  // entities made SWR report our own requested value back, this effect read
  // that as "HA caught up" and dropped the hold ~500ms after the tap, and the
  // `void mutate()` in runAction's finally then refetched HA's still-stale
  // number and stomped the display. Measured on the test stack against the
  // real Kitchen unit: tap at 0ms showed 23.5°, reverted to 23.0° at 619ms,
  // and only settled back to 23.5° at 7624ms — a seven-second lie, which is
  // the precise confusion this whole hook exists to remove. `pendingTarget`
  // is already the optimism for this entity, and the tile and modal share one
  // hook instance, so nothing needed that snapshot in the first place.
  useEffect(() => {
    if (pendingTarget == null || climate.targetTemp == null) return;
    if (Math.abs(climate.targetTemp - pendingTarget) <= TARGET_EPSILON) {
      setPendingTarget(null);
      clearTimers();
    }
    // Only re-run when the two values that matter change; clearTimers is
    // stable in effect (it only touches refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [climate.targetTemp, pendingTarget]);

  // Timers must not outlive the tile (a room that goes offline / a modal
  // that unmounts its own instance shouldn't fire a stale setState later).
  useEffect(() => clearTimers, []);

  // The new interacting timer is a separate ref from clearTimers' pair
  // above (debounce/TTL) precisely so a normal write-hold expiry (commit's
  // own TTL) doesn't also cut the adjusting isolation short — but it still
  // must not outlive the tile.
  useEffect(() => {
    return () => {
      if (interactingTimerRef.current) clearTimeout(interactingTimerRef.current);
    };
  }, []);

  // Tracks which way displayTarget last moved, for KioskDigitReel — see
  // reelDirection's own doc comment on TargetControl for why bump()'s own
  // gesture takes priority over this inference.
  useEffect(() => {
    if (prevDisplayRef.current != null && displayTarget != null && displayTarget !== prevDisplayRef.current) {
      if (bumpDirectionRef.current != null) {
        setReelDirection(bumpDirectionRef.current);
        bumpDirectionRef.current = null;
      } else {
        setReelDirection(displayTarget > prevDisplayRef.current ? 1 : -1);
      }
    }
    prevDisplayRef.current = displayTarget;
  }, [displayTarget]);

  function commit(value: number) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // No optimistic snapshot on purpose — see the release effect above.
      // `pendingTarget` already owns the optimistic display, and feeding our
      // own value back through SWR is what let the hold release against
      // itself.
      void ha.runAction({ entityId: climate.entityId, action: "set_temp", temperature: value }).then((ok) => {
        if (!ok) {
          // The write itself failed (not just "HA hasn't caught up yet") —
          // drop the held value right away rather than let it sit until the
          // TTL, and let ha.actionErrors carry the existing failure message.
          setPendingTarget(null);
          clearTimers();
        }
      });
    }, TARGET_WRITE_DEBOUNCE_MS);

    // A fresh TTL window per tap: each additional tap is a sign the user is
    // still actively adjusting, so it re-earns the full hold period rather
    // than being cut off mid-adjustment by an earlier tap's clock.
    if (ttlRef.current) clearTimeout(ttlRef.current);
    ttlRef.current = setTimeout(() => setPendingTarget(null), TARGET_HOLD_TTL_MS);
  }

  function bump(direction: 1 | -1) {
    const base = pendingTarget ?? climate.targetTemp;
    if (base == null) return;
    const raw = Math.min(max, Math.max(min, base + direction * step));
    // Kill the float noise a division/multiplication snap can introduce
    // (e.g. 23.499999999996) — half-degree steps should render as exactly
    // that.
    const snapped = Math.round(raw / step) * step;
    const next = Math.round(snapped * 1000) / 1000;
    setPendingTarget(next);
    commit(next);

    // The gesture's own direction — consumed by the reelDirection effect
    // above the moment this render's displayTarget change lands, so the reel
    // rolls the way the tap actually went rather than waiting to infer it.
    bumpDirectionRef.current = direction;

    // Adjusting isolation: true immediately, with the timer RESET on every
    // bump (not merely started once) so a run of taps stays one continuous
    // interaction instead of the isolation flickering off between taps.
    setInteracting(true);
    if (interactingTimerRef.current) clearTimeout(interactingTimerRef.current);
    interactingTimerRef.current = setTimeout(() => setInteracting(false), FOCUS_HOLD_MS);
  }

  return {
    displayTarget,
    lowerDisabled: displayTarget != null && displayTarget <= min,
    raiseDisabled: displayTarget != null && displayTarget >= max,
    bump,
    interacting,
    reelDirection,
  };
}
