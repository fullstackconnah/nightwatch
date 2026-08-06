"use client";

/* THESIS: a compact per-room TILE (2026-08-03 follow-up — supersedes the
   full-width row this file used to render), laid out by kiosk-hub.tsx's
   ClimateSection as a grid instead of stacked rows: at 4 climate entities,
   four tiles now fit in a single row at both 1024×768 and 1180×820 where
   four stacked rows cost ~326px of the panel's own height. Advanced
   controls (HVAC mode, dual setpoint) that don't need to be visible at a
   glance still move into the full-screen modal, reachable from a small
   corner button rather than a fourth inline control — a tile this narrow
   has no room for a fourth 56px target sitting flush with the others, and
   the corner keeps it clearly separate from the −/target/+ cluster it must
   not be mistaken for.

   The `[−]  target  [+]` shape (target BETWEEN the two buttons, not beside
   them) is the specific layout the owner asked for — this is a from-scratch
   arrangement, not the old row's controls simply narrowed.

   OWN-WORLD: mirrors kiosk-hub.tsx's own composition choice (THESIS there) —
   this file owns NUDGE_STEP/HVAC_LABEL/formatTemp as its own copies rather
   than importing from ha-climate.tsx (the authenticated /smarthome twin),
   because the two surfaces are intentionally allowed to drift (public kiosk
   vs. authenticated dashboard). The one exception is `UseKioskHaResult`,
   imported as a type-only from kiosk-hub.tsx — duplicating that shape would
   risk the optimistic-update contract silently drifting between the hook and
   its consumer. */

import { useEffect, useRef, useState } from "react";
import { Power, SlidersHorizontal, X } from "lucide-react";
import type { HaClimate, HaEntities } from "@/lib/ha-types";
import type { UseKioskHaResult } from "@/components/kiosk-hub";
import { cn } from "@/lib/utils";
import { KioskDigitReel } from "@/components/kiosk-digits";
import { KIOSK_POP_MS, KIOSK_EASE_OUT, prefersReducedMotion } from "@/lib/kiosk-motion";
import { useKioskTheme } from "@/components/kiosk-theme";

const NUDGE_STEP = 0.5;

const HVAC_LABEL: Record<string, string> = {
  off: "Off",
  heat: "Heat",
  cool: "Cool",
  heat_cool: "Range",
  auto: "Auto",
  dry: "Dry",
  fan_only: "Fan",
};

function formatTemp(v: number | null, unit: string | null): string {
  if (v == null) return "—";
  // HA's unit_of_measurement for a climate entity is typically already the
  // full "°C"/"°F" (confirmed against a real HA response, not just a bare
  // letter) — unconditionally prepending our own "°" on top of that rendered
  // "21.5°°C" everywhere. Production's own climate entities happen to report
  // no unit at all, which is why that doubling never showed up there; the
  // fix has to hold for both a populated and an empty/null unit. Trim stray
  // whitespace HA sometimes includes, and only add the degree ourselves when
  // the unit doesn't already carry one.
  const unitTrimmed = (unit ?? "").trim();
  const degree = unitTrimmed.startsWith("°") ? "" : "°";
  return `${v.toFixed(1)}${degree}${unitTrimmed}`;
}

/** A heat_cool range is ONE reading, not two. Rendering the low and high as
 *  separate stacked lines dropped the relationship between them entirely —
 *  "19.0°C" above "22.0°C" scans as two unrelated numbers rather than a band.
 *  One line, an en dash, and the unit stated once at the end. */
function formatTempRange(low: number | null, high: number | null, unit: string | null): string {
  // Either bound missing means this isn't really a range — fall back to
  // whichever value exists rather than rendering a half-open "19.0–—".
  if (low == null || high == null) return formatTemp(low ?? high, unit);
  const unitTrimmed = (unit ?? "").trim();
  const degree = unitTrimmed.startsWith("°") ? "" : "°";
  return `${low.toFixed(1)}–${high.toFixed(1)}${degree}${unitTrimmed}`;
}

/** HA's fan/preset/swing mode strings ("Level 2", "eco", "on") arrive in
 *  whatever case the integration chose — HVAC_LABEL is a hand-picked map
 *  because there are only 7 hvac modes total, but fan/preset/swing are
 *  per-unit and open-ended, so this just capitalizes the first letter
 *  ("eco" -> "Eco") rather than hardcoding a table for values this app has
 *  no fixed list of. */
function titleCase(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Shared visual for the 56px −/+ nudge buttons — borderless at rest, a
// hairline ring only on hover/active/focus so the cluster reads as open
// ground rather than a boxed control pair (redesign-06 ban on decorative
// chrome).
// kiosk-press replaces the bare active:scale-[0.98] this used to carry —
// leaving both would have meant two competing `transform` rules fighting
// over the same press (see globals.css's own comment on `.kiosk-press`'s
// cascade-layer reasoning).
const NUDGE_BUTTON =
  "flex h-14 w-14 shrink-0 items-center justify-center rounded-tile font-mono text-lg text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent kiosk-press disabled:pointer-events-none disabled:opacity-40";

// The corner expand button is still a real 56px hit target (touch floor
// invariant holds regardless of where a control sits), but it visually reads
// small — deliberately offset outside the tile's own padding box on two
// edges (see its `-top-1.5 -right-1.5` below) so its footprint doesn't eat
// into the name row's line height, and so it's unambiguously NOT part of the
// −/target/+ cluster beneath it (the owner's ask: don't let it compete with
// the nudge controls). The gap between the two is a full row of content
// (name, then current-temp), not just a few px — the strongest possible
// separation short of moving it off the tile entirely.
//
// FIX (2026-08-04): that negative offset used to sit on the <button> itself,
// so its 56px ring/hover box visibly crossed the tile's own rounded border on
// hover/focus/active, and the glyph sat proud of the corner. The 56px target
// still has to overhang the tile — the name row only reserves px-8 (32px)
// either side, less than half the button's width — so the fix keeps the
// offset on the button but strips it of any visible chrome (no ring, no
// background, no rounding) and moves the actual affordance onto a smaller
// centred `<span>` (`*_CHIP` below, ~36px) that lands well inside the tile
// edge at this offset. `group`/`group-*` threads hover/focus-visible/active
// from the real interactive element (the button — a11y and click target)
// onto that inner chip, since CSS can't apply `:focus-visible` styling to a
// non-ancestor element directly.
// FIX (2026-08-05), the sunroom half of the same story: stripping the ring and
// background off this button was enough for the 15 flat themes, but sunroom
// styles `button` itself — a raised soft-UI box-shadow on :active and a warmth
// bloom on [aria-pressed="true"] (globals.css). Those landed on this 56px
// overhanging hit area, so the power button on a RUNNING unit painted a 56×56
// lit box crossing the tile's own rounded border on two sides — measured on
// production's Office AC tile: button box x641/y187.5 against a tile starting
// at x646/y192.5. `kiosk-hitarea` is the opt-out: globals.css suppresses those
// two shadows on the button and re-hangs the bloom on the inner chip, which
// sits fully inside the tile at this offset.
const EXPAND_BUTTON =
  "kiosk-hitarea group absolute -top-1.5 -right-1.5 flex h-14 w-14 items-center justify-center text-ink-dim outline-none transition hover:text-ink disabled:pointer-events-none disabled:opacity-40";

// Same kiosk-press swap as NUDGE_BUTTON above, in place of the
// group-active:scale-[0.98] this chip used to carry — the chip is the actual
// visible affordance (EXPAND_BUTTON itself is deliberately chromeless), so
// its own :active is what kiosk-press now answers to.
const EXPAND_BUTTON_CHIP =
  "flex h-9 w-9 items-center justify-center rounded-tile ring-1 ring-transparent transition group-hover:ring-line-bright group-focus-visible:ring-1 group-focus-visible:ring-accent kiosk-press";

/** Mirrors EXPAND_BUTTON on the opposite corner. Same 56px touch target, same
 *  negative offset so it overhangs the tile's own padding rather than stealing
 *  a column from the two rows of text between them, and the same invisible
 *  hit-area / inner-chip split (see EXPAND_BUTTON's comment). */
const POWER_BUTTON =
  "kiosk-hitarea group absolute -top-1.5 -left-1.5 flex h-14 w-14 items-center justify-center outline-none disabled:pointer-events-none disabled:opacity-40";

// Same kiosk-press swap, mirrored from EXPAND_BUTTON_CHIP above.
const POWER_BUTTON_CHIP =
  "flex h-9 w-9 items-center justify-center rounded-tile ring-1 ring-transparent transition group-hover:ring-line-bright group-focus-visible:ring-1 group-focus-visible:ring-accent kiosk-press";

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
function preferredOnMode(modes: string[]): string | null {
  for (const wanted of ["heat_cool", "auto", "heat", "cool"]) {
    if (modes.includes(wanted)) return wanted;
  }
  return modes.find((m) => m !== "off") ?? null;
}

/* ── last-used mode memory (2026-08-04) ─────────────────────────────────────
   The power button used to always guess via preferredOnMode, which for this
   house's units lands on "auto" (they expose heat_cool/auto/heat/cool but not
   heat_cool as truly dual — see ha-types.ts). The owner wants power-on to
   instead resume whatever mode the unit was actually last running in,
   including a mode set from the AC's own remote or the HA app rather than
   from this tile — so the write happens from an effect watching the OBSERVED
   hvacMode, not from setMode's call site. */

const LAST_MODE_STORAGE_KEY = "kiosk-climate-last-mode";

type LastModeMap = Record<string, string>;

/** Defensive parse, same idiom as kiosk-theme.tsx's stored-theme read: a
 *  missing key, invalid JSON, or a corrupt/wrong-shaped blob all degrade to
 *  "nothing remembered" rather than throwing and bricking the tile. */
function readLastModes(): LastModeMap {
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
function writeLastMode(entityId: string, mode: string): void {
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
   the ABSOLUTE set_temp action (see ha-types.ts) and debounces the write, so
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
const MODE_RECHECK_MS = 5_000;
/** Stop overriding HA after this, agreement or not. A hold that never expires
 *  would show a value the unit rejected (an hvac mode the integration dropped,
 *  a fan level a firmware update removed) as if it had taken. Matches
 *  TARGET_HOLD_TTL_MS — same devices, same round trips. */
const MODE_HOLD_TTL_MS = 20_000;

/** The four mode attributes this hold covers. Not the setpoint: that has its
 *  own hook (useTargetControl) with a debounce and an accumulating value, which
 *  these don't need — each of these is one absolute write per tap. */
type ClimateModeAttr = "hvacMode" | "fanMode" | "presetMode" | "swingMode";

interface ModeHolds {
  /** What to render for `attr`: the held selection while one is outstanding,
   *  otherwise HA's own value. */
  display: (attr: ClimateModeAttr) => string | undefined;
  /** Show `value` immediately, run `write`, then reconcile against HA. */
  select: (attr: ClimateModeAttr, value: string, write: () => void) => void;
}

function useModeHolds(climate: HaClimate, ha: UseKioskHaResult): ModeHolds {
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

const TARGET_WRITE_DEBOUNCE_MS = 500;
// 7.6s measured round-trip for one of these IR units to report a new
// setpoint with the unit already on; 10s left almost no margin, and a TTL
// that fires before HA catches up snaps the display backwards — the exact
// failure this hook exists to remove. Erring toward holding the user's own
// requested number too long is the safer direction.
const TARGET_HOLD_TTL_MS = 20_000;
/** Float-noise tolerance when comparing the held target against what HA
 *  reports back — both sides are half-degree-stepped numbers, but IEEE float
 *  equality isn't safe to trust at face value. */
const TARGET_EPSILON = 0.05;

/** How long the tile/modal stay in "adjusting" isolation after a nudge tap,
 *  reset on every tap so a run of them reads as one continuous interaction.
 *  Deliberately NOT TARGET_HOLD_TTL_MS (20s) below: that write hold can sit
 *  unresolved for the full 20 seconds if HA never confirms the value, and
 *  driving focus isolation off it would leave the OTHER tiles blurred for 20
 *  seconds after a single tap on this one — the nudge case the brief names
 *  needs the isolation to lift the moment a finger actually stops moving,
 *  not to wait out a round-trip that might not even be finished. */
const FOCUS_HOLD_MS = 1200;

interface TargetControl {
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
 *  null on every one of them; see ha-types.ts). Dual-setpoint tiles keep
 *  using the pre-existing relative `nudge` below unchanged, per the owner's
 *  "leave it working, do not expand it" instruction — this hook is additive,
 *  not a replacement for that dead-but-functional path. */
/* Takes no `entities` snapshot: this hook writes an ABSOLUTE setpoint and
   owns the optimistic display itself, so it has no reason to build one. */
function useTargetControl(climate: HaClimate, ha: UseKioskHaResult): TargetControl {
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

/* ── tile ────────────────────────────────────────────────────────────────── */

export function KioskClimateTile({
  ha,
  climate,
  entities,
  focused,
  onAdjustingChange,
}: {
  ha: UseKioskHaResult;
  climate: HaClimate;
  entities: HaEntities;
  /** True when this tile is the one currently being adjusted — see
   *  kiosk-hub.tsx's ClimateSection, which owns the grid-level
   *  `data-kiosk-focus`/`adjustingId` state this drives (contract in
   *  .claude/state/kiosk-motion-contract.md). */
  focused?: boolean;
  /** Reports the start and end of a live adjustment on this tile, so the
   *  grid can arm/disarm the depth-of-field isolation on its siblings. */
  onAdjustingChange?: (adjusting: boolean) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const advancedButtonRef = useRef<HTMLButtonElement>(null);

  const pending = ha.isPending(climate.entityId);
  const error = ha.actionErrors[climate.entityId];
  const dualSetpoint = climate.targetTempLow != null && climate.targetTempHigh != null;

  /* Every mode this tile and its modal RENDER comes from here, not from
     `climate` directly — see useModeHolds. `climate.*` is still the truth the
     hold reconciles against, and the two effects below deliberately keep
     reading it rather than the display value: what to remember as "last used"
     is what the unit actually ran in, never what somebody asked for and might
     not have got. */
  const modeHolds = useModeHolds(climate, ha);
  const shownHvacMode = modeHolds.display("hvacMode") ?? climate.hvacMode;
  // Drives the tile's whole on-state vocabulary (accent border/wash, the power
  // glyph, aria-pressed), so a tap flips the tile the instant it lands instead
  // of after the unit reports back.
  const isOn = shownHvacMode !== "off";

  // The SELECTED mode alone decides the tile's colour, and ONLY under the
  // sunroom theme — both owner's calls. This replaces the current-vs-target
  // inference the deleted convection streams used (kiosk-thermal.tsx). The
  // colour answers "what did I set this to", not "which way is it pushing
  // air this minute", and lands the instant the mode is picked (keyed on
  // shownHvacMode for the same mode-hold reason as isOn above — a tap must
  // recolour the tile before HA reports back). Every ON mode carries a tint
  // and the breathing edge glow: heat -> --color-heat (orange-red), cool ->
  // --color-chill (icy cyan), dry -> --color-arid (bright amber), and
  // fan_only/heat_cool/auto -> "neutral", the shared accent-on vocabulary,
  // because they name no single kind of work. The root-locked tokens (see
  // @theme) exist because sunroom's scoped warn/blue are AA-darkened for
  // text and muddy a wash to brown/grey. Every non-sunroom theme keeps the
  // plain accent-on look with no glow — the mode tint is part of sunroom's
  // dress-up (the one theme whose whole surface is a light-and-warmth
  // model), not a new system-wide colour language; modeTint is null
  // off-theme, which also suppresses the glow layer below.
  const kioskTheme = useKioskTheme();
  const modeTint: "heat" | "chill" | "arid" | "neutral" | null =
    kioskTheme !== "sunroom" || !isOn
      ? null
      : shownHvacMode === "heat"
        ? "heat"
        : shownHvacMode === "cool"
          ? "chill"
          : shownHvacMode === "dry"
            ? "arid"
            : "neutral";
  const modeTintVar =
    modeTint === "heat"
      ? "var(--color-heat)"
      : modeTint === "chill"
        ? "var(--color-chill)"
        : modeTint === "arid"
          ? "var(--color-arid)"
          : "var(--color-accent)";

  // Remembered last-used mode (see the last-mode-memory block above
  // preferredOnMode): SSR-safe null seed, filled in from localStorage after
  // mount, exactly like kiosk-theme.tsx's useKioskTheme seeds "default" and
  // reads the real stored value only inside an effect.
  const [rememberedMode, setRememberedMode] = useState<string | null>(null);
  useEffect(() => {
    setRememberedMode(readLastModes()[climate.entityId] ?? null);
  }, [climate.entityId]);
  // Records whatever mode HA reports whenever it's non-off — a mode changed
  // from the unit's own remote or the HA app must be remembered too, not
  // only one set from this tile, so this watches the OBSERVED hvacMode
  // rather than hooking setMode's call site.
  useEffect(() => {
    if (climate.hvacMode === "off") return;
    writeLastMode(climate.entityId, climate.hvacMode);
    setRememberedMode(climate.hvacMode);
  }, [climate.entityId, climate.hvacMode]);

  // Prefer the remembered mode, but only if this unit still actually offers
  // it (hvac_modes can change between HA restarts/integration updates) —
  // preferredOnMode stays as the fallback for a first run with nothing
  // remembered yet, or a remembered mode this unit no longer advertises.
  const onMode =
    rememberedMode && climate.hvacModes.includes(rememberedMode) ? rememberedMode : preferredOnMode(climate.hvacModes);
  // No mode to switch INTO means the power button would be a control that
  // can't do anything — better absent than dead. (A unit that only reports
  // "off" is a broken integration, but this surface shouldn't render a lie
  // about it either way.)
  const canPower = climate.available && (isOn || onMode !== null);
  const nudgeable = climate.available && (climate.targetTemp != null || dualSetpoint);

  // Always called (Rules of Hooks) — harmless for a dual-setpoint tile,
  // since climate.targetTemp is null there and this hook's own displayTarget
  // then stays null too; the dual-setpoint UI below keeps using `nudge`.
  const targetControl = useTargetControl(climate, ha);

  // Reports targetControl.interacting ONLY — deliberately NOT modalOpen.
  // The modal covers the whole viewport when open, so defocusing the tiles
  // behind it is invisible work nobody on the kiosk can see; the grid-level
  // isolation this callback drives exists for the nudge-tap case the brief
  // actually names (adjusting a tile while its siblings are still visible),
  // and modalOpen has nothing to do with that case.
  useEffect(() => {
    onAdjustingChange?.(targetControl.interacting);
  }, [targetControl.interacting, onAdjustingChange]);

  /* The four mode setters all go through useModeHolds now, and all four have
     LOST the optimistic HaEntities snapshot they used to pass. That snapshot
     was the thing making the report happen: it moved `climate.hvacMode` to the
     requested value for a few hundred ms, then runAction's own refetch put HA's
     still-stale value back with nothing holding the display. The hold does that
     job properly and reconciles on a timer instead. See useModeHolds.

     `entities` is consequently no longer read by these four — the relative
     `nudge` below still builds a snapshot, because the dual-setpoint path it
     serves is unchanged by this work. */
  const setMode = (mode: string) => {
    modeHolds.select("hvacMode", mode, () => {
      void ha.runAction({ entityId: climate.entityId, action: "set_hvac_mode", hvacMode: mode });
    });
  };

  const nudge = (delta: number) => {
    const next: HaEntities = {
      ...entities,
      climates: entities.climates.map((c) => {
        if (c.entityId !== climate.entityId) return c;
        if (dualSetpoint) {
          return {
            ...c,
            targetTempLow: c.targetTempLow != null ? c.targetTempLow + delta : c.targetTempLow,
            targetTempHigh: c.targetTempHigh != null ? c.targetTempHigh + delta : c.targetTempHigh,
          };
        }
        return { ...c, targetTemp: c.targetTemp != null ? c.targetTemp + delta : c.targetTemp };
      }),
    };
    void ha.runAction({ entityId: climate.entityId, action: "nudge_temp", delta }, next);
  };

  const setFanMode = (mode: string) => {
    modeHolds.select("fanMode", mode, () => {
      void ha.runAction({ entityId: climate.entityId, action: "set_fan_mode", fanMode: mode });
    });
  };

  const setPresetMode = (mode: string) => {
    modeHolds.select("presetMode", mode, () => {
      void ha.runAction({ entityId: climate.entityId, action: "set_preset_mode", presetMode: mode });
    });
  };

  const setSwingMode = (mode: string) => {
    modeHolds.select("swingMode", mode, () => {
      void ha.runAction({ entityId: climate.entityId, action: "set_swing_mode", swingMode: mode });
    });
  };

  // Focus returns to the button that opened the modal, not document body —
  // same rationale as KioskPinPad's own restore-on-unmount effect.
  const closeModal = () => {
    setModalOpen(false);
    advancedButtonRef.current?.focus();
  };

  return (
    <div
      className={cn(
        // `transition-colors` REMOVED — it is now inert, not merely
        // redundant. `.kiosk-defocus` (globals.css) is UNLAYERED CSS
        // declaring its own `transition:` shorthand, and Tailwind v4 puts
        // its own utilities inside `@layer utilities`; by the cascade-layers
        // spec, an unlayered declaration beats a layered one outright
        // regardless of specificity, so `.kiosk-defocus`'s `transition`
        // deletes `transition-colors` completely rather than merely
        // outranking it for the properties they share. The tile's own
        // colour transition moves to an inline `style` below instead —
        // inline style is the one thing that outranks unlayered CSS too.
        "relative flex flex-col items-center gap-2 rounded-tile border p-3 text-center",
        // isolate: makes this tile root a stacking context, which is what
        // lets the working-tint layer's `-z-10` paint above this tile's own
        // background and below its text WITHOUT escaping to some ancestor's
        // stacking context instead — see that layer's own comment below on
        // the point.
        "isolate",
        // kiosk-defocus: this tile is itself a sibling inside
        // ClimateSection's `data-kiosk-focus` group (kiosk-hub.tsx) — when
        // another tile is being adjusted, this one recedes with the rest.
        "kiosk-defocus",
        // kiosk-sheen requires `relative`, which this root already carries.
        "kiosk-sheen",
        // The container wears the SELECTED mode's colour (see modeTint
        // above) the instant the mode is picked; off keeps the neutral
        // panel, and neutral/off-theme running keeps the SAME on-state
        // vocabulary the light and switch pills use (kiosk-hub.tsx's
        // ToggleChip: accent border, accent wash) — that pairing is already
        // contrast-checked across all 16 themes. The tint crossfade on a
        // mode change rides `.kiosk-defocus`'s owned transition list for
        // free (see that class's comment lower down).
        !isOn
          ? "border-line bg-panel-2"
          : modeTint === "heat"
            ? "border-heat/40 bg-heat/10"
            : modeTint === "chill"
              ? "border-chill/40 bg-chill/10"
              : modeTint === "arid"
                ? "border-arid/40 bg-arid/10"
                : "border-accent/40 bg-accent/10",
        !climate.available && "opacity-60",
      )}
      // This tile is the one being adjusted (ClimateSection's `focused`
      // prop) — exempts it from the blur/dim `[data-kiosk-focus="on"]
      // .kiosk-defocus` rule applies to its unfocused siblings, and (per
      // globals.css's FILTER IS A CONTAINING BLOCK note) keeps it eligible
      // to host this tile's own modal without re-parenting a fixed dialog
      // into a blurred, 2cm-wide containing block.
      data-kiosk-focused={focused ? "true" : undefined}
      // NO inline `transitionProperty` here, and that is a fix rather than an
      // omission. This tile carried one to get background-color/border-color
      // into the transition list that `.kiosk-defocus` owns — and an inline
      // declaration outranks a `@media (prefers-reduced-motion: reduce)` rule
      // just as thoroughly as it outranks a cascade layer, so it silently
      // defeated the reduced-motion escape: measured on the test stack with
      // reduced motion on, this tile still reported
      // `transition-property: opacity, filter, background-color, border-color`.
      // `.kiosk-defocus` names all four itself now, so the one place that turns
      // motion off can reach every one of them.
    >
      {/* The one live-state motion this tile keeps: a slow pulse of a
          mode-coloured glow hugging the tile's border and fading inward,
          over the container's own 10% tint, saying "actively moving air" —
          replacing the four blurred convection streams the owner rejected
          as neither subtle nor
          mode-legible at the container level. Rendered for every ON tile
          under sunroom (modeTint non-null), in that tile's own mode colour —
          accent for the neutral fan/auto modes — and never off-theme.
          First child, -z-10 + the root's `isolate` above: same painting-order
          arrangement the streams used, so this layer sits above the tile's
          background and below its text (see the isolate comment). aria-hidden:
          purely decorative, adds nothing a screen reader needs — the tile's
          own mode label already says "Heat"/"Cool" in text. */}
      {modeTint !== null && (
        <div
          aria-hidden
          className="kiosk-climate-working pointer-events-none absolute inset-0 -z-10 rounded-tile"
          // The glow is an INSET box-shadow — strongest at the tile's border,
          // fading toward the centre (owner's spec) — plus a faint centre
          // wash so the middle isn't hollow, both in modeTintVar's root-locked
          // mode colour (see the @theme comment on --color-heat for why the
          // theme-scoped warn/blue can't be used here). The shadow itself is
          // static; only the layer's opacity pulses (see .kiosk-climate-working).
          style={{
            boxShadow: `inset 0 0 18px 2px color-mix(in srgb, ${modeTintVar} 45%, transparent)`,
            background: `color-mix(in srgb, ${modeTintVar} 4%, transparent)`,
          }}
        />
      )}

      {canPower && (
        <button
          type="button"
          onClick={() => setMode(isOn ? "off" : (onMode as string))}
          disabled={pending}
          aria-pressed={isOn}
          aria-label={`${isOn ? "Turn off" : "Turn on"} ${climate.name}`}
          title={isOn ? `Turn off ${climate.name}` : `Turn on ${climate.name}`}
          // ink-faint has no AA headroom left for an interactive control's own
          // glyph (CLAUDE.md: it's microlabel-only) — ink-dim in the off state.
          className={cn(POWER_BUTTON, isOn ? "text-accent" : "text-ink-dim hover:text-ink")}
        >
          <span className={POWER_BUTTON_CHIP}>
            <Power size={20} aria-hidden />
          </span>
        </button>
      )}

      {/* Name row reserves space on BOTH sides now (px-8): the power button
          overhangs the left corner and the expand button the right, and the
          name has to truncate before it reaches either. */}
      <div className="flex w-full items-center justify-center gap-1.5 px-8">
        <span className="min-w-0 truncate text-sm text-ink sm:text-base">{climate.name}</span>
        {!climate.available && <span className="microlabel !text-warn shrink-0">unavailable</span>}
      </div>

      <button
        ref={advancedButtonRef}
        type="button"
        disabled={!climate.available}
        aria-label={`Advanced controls for ${climate.name}`}
        onClick={() => setModalOpen(true)}
        className={EXPAND_BUTTON}
      >
        <span className={EXPAND_BUTTON_CHIP}>
          <SlidersHorizontal size={15} aria-hidden />
        </span>
      </button>

      {/* Distance-readable figure — the number a person 2-3m away actually
          needs, unchanged in size from the row version. */}
      <div className="font-mono text-3xl text-ink">{formatTemp(climate.currentTemp, climate.unit)}</div>

      {/* [−]  target  [+] — target BETWEEN the two buttons, the shape asked
          for, not beside them. `min-h-14` on the cluster (not just the
          buttons) keeps every tile the same height whether or not this room
          is nudgeable — a non-nudgeable/unavailable room still reserves the
          same vertical footprint even though it renders no buttons here. */}
      <div className="flex min-h-14 items-center justify-center gap-2">
        {nudgeable && (
          <button
            type="button"
            aria-label={`Lower target temperature for ${climate.name}`}
            // Single-setpoint tiles disable at the entity's own minTemp (once
            // useTargetControl knows it); dual-setpoint keeps the old
            // unbounded relative nudge unchanged.
            disabled={pending || (!dualSetpoint && targetControl.lowerDisabled)}
            onClick={() => (dualSetpoint ? nudge(-NUDGE_STEP) : targetControl.bump(-1))}
            className={NUDGE_BUTTON}
          >
            −
          </button>
        )}

        {/* min-h reserves TWO mono lines' worth of height always, so a
            dual-setpoint tile's stacked low/high pair doesn't make that one
            tile taller than its neighbours (owner's constraint: tiles must
            stay the same size as each other) — a single-value tile just has
            one line sitting centred in the same reserved space. */}
        <div className="flex min-h-[2.5rem] w-20 shrink-0 flex-col items-center justify-center">
          {error ? (
            <div role="alert" title={error} className="microlabel !text-bad w-full truncate">
              {error}
            </div>
          ) : (
            <div className="microlabel">Target</div>
          )}
          <div
            className={cn(
              "mt-0.5 truncate font-mono text-accent",
              // The range is ~11 glyphs against a single value's ~6, in a tile
              // whose width is already spoken for by two 56px nudge buttons —
              // one step down keeps it on its own line instead of truncating.
              dualSetpoint ? "text-sm" : "text-base",
            )}
          >
            {dualSetpoint ? (
              // A two-value range with a dash is not a dial — the
              // dual-setpoint path stays plain text, unchanged.
              formatTempRange(climate.targetTempLow, climate.targetTempHigh, climate.unit)
            ) : (
              // The reel goes on the TARGET, never the current reading: the
              // target is the number you turn, and the current temperature
              // is the room answering — rolling the room's answer would
              // claim the wall panel had changed it. The held value (see
              // useTargetControl) — NOT climate.targetTemp directly, or a
              // tap would show the exact stomped-then-stale number this
              // whole hook exists to fix.
              <KioskDigitReel
                text={formatTemp(targetControl.displayTarget, climate.unit)}
                direction={targetControl.reelDirection}
              />
            )}
          </div>
        </div>

        {nudgeable && (
          <button
            type="button"
            aria-label={`Raise target temperature for ${climate.name}`}
            disabled={pending || (!dualSetpoint && targetControl.raiseDisabled)}
            onClick={() => (dualSetpoint ? nudge(NUDGE_STEP) : targetControl.bump(1))}
            className={NUDGE_BUTTON}
          >
            +
          </button>
        )}
      </div>

      {modalOpen && (
        <KioskClimateModal
          climate={climate}
          // The four displayed modes, held-aware (see useModeHolds). Passed in
          // rather than read off `climate` inside the modal so the tile and its
          // modal cannot disagree about what is selected — they share one hold,
          // the same way they already share one targetControl.
          shownModes={{
            hvacMode: shownHvacMode,
            fanMode: modeHolds.display("fanMode"),
            presetMode: modeHolds.display("presetMode"),
            swingMode: modeHolds.display("swingMode"),
          }}
          pending={pending}
          error={error}
          dualSetpoint={dualSetpoint}
          nudgeable={nudgeable}
          onNudge={nudge}
          onSetMode={setMode}
          onSetFanMode={setFanMode}
          onSetPresetMode={setPresetMode}
          onSetSwingMode={setSwingMode}
          targetControl={targetControl}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

/** The visible heading every control group in the modal now carries, plus its
 *  current value on the same line.
 *
 *  Until 2026-08-05 these groups had an `aria-label` and nothing else: four
 *  unlabelled banks of chips (6 hvac modes, 8 fan levels, 3 presets, 2 swing
 *  values) stacked down the panel, and no way to tell from looking which bank
 *  did what. A screen reader got the answer and a person standing at the wall
 *  did not — the exact inversion of who this surface is for.
 *
 *  The value is echoed on the right rather than left to the chips' own pressed
 *  state alone, because with four groups on screen the pressed chip is one tint
 *  among twenty-odd controls; as a line of type next to the heading it reads at
 *  a glance and, on the slider below, it is the ONLY readout. */
function GroupHeading({ title, value }: { title: string; value?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span className="microlabel">{title}</span>
      <span className="font-mono text-xs text-accent">{value ?? "—"}</span>
    </div>
  );
}

/** Shared chip-row rendering for every mode picker in the modal (hvac, and
 *  now fan/preset/swing) — one visual language rather than a fifth control
 *  inventing its own. `flex-wrap` is load-bearing, not decorative: these
 *  units offer 7 fan levels + Auto, which overflows a single row at the
 *  modal's own max-w-md. Renders nothing when `options` is empty, which is
 *  what makes "only render a control group this entity actually advertises"
 *  true without every call site repeating the same length check. */
function ModeChipGroup({
  title,
  groupLabel,
  options,
  current,
  pending,
  displayLabel,
  ariaLabel,
  onSelect,
  className,
  focused,
}: {
  /** The visible heading — see GroupHeading. `groupLabel` stays the
   *  entity-qualified accessible name ("Kitchen fan speed"); this is the short
   *  human one ("Fan speed"), since the modal's own title already says which
   *  room you are in and repeating it four times reads as noise. */
  title: string;
  groupLabel: string;
  options: string[];
  current?: string;
  pending: boolean;
  displayLabel: (mode: string) => string;
  ariaLabel: (mode: string) => string;
  onSelect: (mode: string) => void;
  /** Passed by the modal so this group can carry `kiosk-defocus` — a chip tap
   *  is a single instant write, not a sustained interaction, so no group here
   *  ever sets `data-kiosk-focused`; it only ever recedes when SOME OTHER
   *  group in the modal is being adjusted. */
  className?: string;
  focused?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <div className={cn("mt-6", className)} role="group" aria-label={groupLabel} data-kiosk-focused={focused ? "true" : undefined}>
      <GroupHeading title={title} value={current ? displayLabel(current) : undefined} />
      <div className="flex flex-wrap justify-center gap-2">
        {options.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={current === mode}
            aria-label={ariaLabel(mode)}
            disabled={pending}
            onClick={() => onSelect(mode)}
            className={cn(
              // kiosk-press replaces the bare active:scale-[0.98] this chip
              // used to carry — see NUDGE_BUTTON's comment above for why
              // leaving both would fight over one `transform`.
              "h-14 min-w-[4.5rem] rounded-md border px-3 text-xs font-medium outline-none transition focus-visible:ring-1 focus-visible:ring-accent kiosk-press disabled:pointer-events-none disabled:opacity-40",
              current === mode
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-line text-ink-dim hover:bg-panel hover:text-ink",
            )}
          >
            {displayLabel(mode)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── the fan-speed ladder ───────────────────────────────────────────────────
   These units advertise `["Level 1" … "Level 7", "Auto"]`, which as chips is
   eight 56px targets wrapping onto two rows — a third of the modal's height
   spent on one attribute, and no visual hint that the seven levels are ORDERED
   at all. A slider says that in its shape, and Auto sits at the far end as the
   ninth position past the ladder rather than as a chip that looks like just
   another level.

   The shape is detected, never assumed: a unit whose fan modes are not a level
   ladder (a `["low","medium","high"]` integration, or anything with Auto in the
   middle) falls back to the chip row untouched. Being wrong here would put a
   continuous control over a set of unordered names, which is a worse lie than
   eight chips. */

const LEVEL_RE = /^level\s*(\d+)$/i;

/** True when `modes` is N ordered levels with Auto last — the arrangement the
 *  slider is a faithful picture of, and the only one it is used for. */
function isLevelLadder(modes: readonly string[]): boolean {
  if (modes.length < 4) return false;
  const head = modes.slice(0, -1);
  if (!/^auto$/i.test(modes[modes.length - 1])) return false;
  const numbers = head.map((m) => LEVEL_RE.exec(m)?.[1]);
  if (numbers.some((n) => n === undefined)) return false;
  // Ascending, no gaps — the positions on the track have to mean the numbers
  // printed under them.
  return numbers.every((n, i) => Number(n) === Number(numbers[0]) + i);
}

/** "Level 3" → "3", "Auto" → "Auto". The tick row under the track has one
 *  label per stop and no room for the word "Level" eight times over. */
function tickLabel(mode: string): string {
  return LEVEL_RE.exec(mode)?.[1] ?? mode;
}

/** How long after the last thumb movement the chosen level is actually written
 *  to Home Assistant. A drag across the ladder fires an input event per stop;
 *  each one is an IR command to a physical AC, so they are collapsed into the
 *  one value the thumb settled on. Short enough to feel immediate on release,
 *  long enough that no realistic drag writes twice. */
const FAN_COMMIT_MS = 280;

function FanSpeedSlider({
  groupLabel,
  title,
  options,
  current,
  pending,
  onSelect,
  className,
  focused,
  onDraggingChange,
}: {
  groupLabel: string;
  title: string;
  options: string[];
  current?: string;
  pending: boolean;
  onSelect: (mode: string) => void;
  /** Passed by the modal so this group can carry `kiosk-defocus`. */
  className?: string;
  focused?: boolean;
  /** Reports `dragIndex !== null` — the modal owns the actual boolean state
   *  (Task D.2 needs it to decide the PANEL's `data-kiosk-focus`), so this
   *  lifts just the derived flag rather than moving `dragIndex` itself out of
   *  this component, which still needs it privately for the thumb position. */
  onDraggingChange?: (dragging: boolean) => void;
}) {
  /* `current` is already the tile's HELD value (useModeHolds), so this index is
     the requested level from the moment a write is issued — the slider itself
     no longer needs a hold of its own, only a local position for the span of a
     DRAG, before the debounced write has been sent at all. */
  const committedIndex = current ? options.indexOf(current) : -1;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const commitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drop the local position once `current` has caught up to it, so the slider
  // goes back to being a plain view of the tile's state.
  useEffect(() => {
    if (dragIndex !== null && committedIndex === dragIndex) setDragIndex(null);
  }, [committedIndex, dragIndex]);

  // Reports the drag boundary only — this is the ENTIRE reason a `dragIndex
  // !== null` check exists on the modal side too, rather than the modal
  // trying to infer dragging from `current` changing (which also happens on
  // the non-drag, held-value-catches-up path above).
  useEffect(() => {
    onDraggingChange?.(dragIndex !== null);
  }, [dragIndex, onDraggingChange]);

  // A pending write must not outlive the modal — closing it mid-drag should
  // drop the uncommitted position rather than fire an IR command at a panel
  // nobody is looking at any more.
  useEffect(() => {
    return () => {
      if (commitRef.current) clearTimeout(commitRef.current);
    };
  }, []);

  /* The thumb has to sit somewhere even when the unit reports no fan mode at
     all (an off Kitchen unit does exactly that). It rests at the bottom of the
     ladder in that case, and the readout says "—" rather than naming a level
     the unit never claimed — the position is where you would START from, the
     value is what is true. */
  const shownIndex = dragIndex ?? (committedIndex >= 0 ? committedIndex : 0);
  const shownMode = options[shownIndex];

  function move(next: number) {
    setDragIndex(next);
    if (commitRef.current) clearTimeout(commitRef.current);
    commitRef.current = setTimeout(() => {
      commitRef.current = null;
      const mode = options[next];
      // Re-selecting what is already set would be a pointless IR command.
      if (mode && mode !== current) onSelect(mode);
      else setDragIndex(null);
    }, FAN_COMMIT_MS);
  }

  return (
    <div
      className={cn("mt-6", className)}
      role="group"
      aria-label={groupLabel}
      data-kiosk-focused={focused ? "true" : undefined}
    >
      <GroupHeading
        title={title}
        // Mid-drag this is the level under your thumb (not yet written);
        // otherwise it is the tile's held/actual value.
        value={dragIndex !== null ? shownMode : current}
      />
      <input
        type="range"
        // `.kiosk-range` (globals.css) carries the track/thumb chrome — a
        // range input's thumb can only be reached through vendor
        // pseudo-elements, which utility classes cannot express.
        className="kiosk-range w-full"
        // Chromium paints no filled portion of its own — the track's gradient
        // reads this (see globals.css). Percent of the way along the ladder,
        // not of the value, so Auto at the far end is a full bar.
        style={
          {
            "--kiosk-range-fill": `${(shownIndex / Math.max(1, options.length - 1)) * 100}%`,
          } as React.CSSProperties
        }
        min={0}
        max={options.length - 1}
        step={1}
        value={shownIndex}
        disabled={pending}
        aria-label={groupLabel}
        // Without this a screen reader reads the raw index ("4 of 8"); the
        // levels are what the control is actually set in.
        aria-valuetext={shownMode}
        onChange={(e) => move(Number(e.target.value))}
      />
      {/* One label per stop, aligned to the track's own ends. Not a
          `justify-between` accident: every stop is equally spaced, so the tick
          row is the map that makes the thumb's position readable. */}
      <div className="mt-1 flex justify-between px-0.5">
        {options.map((mode) => (
          <span
            key={mode}
            className={cn("microlabel", mode === shownMode && "!text-accent")}
            aria-hidden
          >
            {tickLabel(mode)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── modal ───────────────────────────────────────────────────────────────── */

function KioskClimateModal({
  climate,
  shownModes,
  pending,
  error,
  dualSetpoint,
  nudgeable,
  onNudge,
  onSetMode,
  onSetFanMode,
  onSetPresetMode,
  onSetSwingMode,
  targetControl,
  onClose,
}: {
  climate: HaClimate;
  /** What each mode picker should show as selected — the tile's hold-aware
   *  values, NOT `climate.*`. Reading the entity directly here would reinstate
   *  the reported bug inside the modal only: the chip would revert the moment
   *  runAction's refetch landed, while the tile behind it stayed correct. */
  shownModes: {
    hvacMode: string;
    fanMode?: string;
    presetMode?: string;
    swingMode?: string;
  };
  pending: boolean;
  error?: string;
  dualSetpoint: boolean;
  nudgeable: boolean;
  onNudge: (delta: number) => void;
  onSetMode: (mode: string) => void;
  onSetFanMode: (mode: string) => void;
  onSetPresetMode: (mode: string) => void;
  onSetSwingMode: (mode: string) => void;
  /** Same hook instance the tile already created — passed down rather than
   *  re-invoked here, so the modal and tile share ONE hold/debounce/TTL
   *  state instead of racing two independent ones for the same entity. */
  targetControl: TargetControl;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedRef = useRef(false);
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const titleId = `kiosk-climate-modal-${climate.entityId}`;
  // Read once: the slider and the chip fallback both need it, and `?? []`
  // twice would hand each branch a fresh array identity for no reason.
  const fanModes = climate.fanModes ?? [];

  // In-modal focus isolation (Task D.2): while a control inside the modal is
  // being adjusted, the other control groups recede. Two independent sources
  // count as "adjusting" — the fan slider's own drag (lifted out via
  // onDraggingChange, since FanSpeedSlider keeps dragIndex private) and the
  // shared targetControl's interacting flag (the same signal the tile itself
  // uses for the grid-level isolation, Task B.4).
  const [fanDragging, setFanDragging] = useState(false);
  const adjusting = targetControl.interacting || fanDragging;

  // Entrance: flip `entered` a frame after mount so the transition actually
  // animates from the initial (opacity 0, scale 0.96) style rather than
  // snapping straight to the end state. Skipped under reduced-motion, per the
  // redesign contract's "never nothing appears" rule — the modal still shows
  // up, just without the pop.
  useEffect(() => {
    reducedRef.current = prefersReducedMotion();
    const node = dialogRef.current;
    node?.focus();
    if (reducedRef.current) {
      setEntered(true);
      return;
    }
    // Forced reflow, not a single rAF: a rAF callback can still coalesce into
    // the same style flush as this mount commit and skip the transition
    // outright — measured on this hardware in kiosk-spark.tsx's useGlide,
    // which this follows. Reading the rect commits the pre-entrance style
    // synchronously, so the entered flip below is guaranteed a real "before"
    // to transition from. `node` can be null here on a component whose
    // dialog is itself conditionally rendered; fall back to the instant flip
    // rather than skip the entrance forever.
    if (node) void node.getBoundingClientRect();
    setEntered(true);
  }, []);

  // Exit plays the reverse transition before actually unmounting (the parent
  // keeps `modalOpen` true until this fires `onClose`), so a tap-to-close
  // doesn't just vanish the panel.
  function requestClose() {
    if (reducedRef.current) {
      onClose();
      return;
    }
    setClosing(true);
    window.setTimeout(onClose, KIOSK_POP_MS);
  }

  // Same Escape + Tab-trap idiom as KioskPinPad's dialog: Escape routes
  // through requestClose (so it gets the same exit animation as any other
  // close), Tab/Shift+Tab cycle within this dialog's own focusable elements.
  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  const shown = entered && !closing;
  const transitionStyle = {
    transitionDuration: `${KIOSK_POP_MS}ms`,
    transitionTimingFunction: KIOSK_EASE_OUT,
  };

  return (
    <div
      aria-hidden={false}
      // bg-bg/60 backdrop-blur-md, not the old /90 + blur-sm: at 90% opacity
      // the room behind reads as a flat black wall and the blur underneath
      // does nothing visible; at 60% with a real blur it reads as
      // out-of-focus depth — the room is still there, just behind glass —
      // which is what makes the modal feel like it's in FRONT of the room
      // rather than swapped in for it. Safe on text contrast: the panel
      // itself is `.panel`, an OPAQUE surface (globals.css: `background:
      // var(--color-panel)`, no alpha channel), so nothing about the modal's
      // own copy sits over this backdrop at all.
      className="fixed inset-0 z-(--z-modal-backdrop) flex items-center justify-center bg-bg/60 px-4 backdrop-blur-md transition-opacity motion-reduce:transition-none"
      style={{ ...transitionStyle, opacity: shown ? 1 : 0 }}
      // Backdrop click closes; target===currentTarget guards against a tap on
      // a real control inside the panel bubbling up and closing unintentionally.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        // Arms the same depth-of-field isolation the climate grid uses
        // (Task B.2), scoped to this panel's own control groups instead of
        // sibling tiles — see `adjusting` above.
        data-kiosk-focus={adjusting ? "on" : undefined}
        /* max-h/overflow-y: four labelled groups plus the setpoint pair is a
           tall panel (measured 718px at a 800px-high viewport BEFORE the
           headings landed), and a wall tablet in landscape has less height than
           that, not more. The glance surface is deliberately scroll-locked, but
           a modal is a deliberate, dismissible visit — clipping its last group
           off the bottom would hide the swing control entirely, so this one box
           is allowed to scroll. */
        className="panel relative z-(--z-modal) max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto p-6 transition-[opacity,transform] motion-reduce:transition-none"
        style={{ ...transitionStyle, opacity: shown ? 1 : 0, transform: shown ? "scale(1)" : "scale(0.96)" }}
      >
        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-sm font-semibold tracking-tight text-ink">
            {climate.name}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close advanced controls"
            className="-mr-2.5 flex h-11 w-11 items-center justify-center text-ink-dim outline-none transition hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Current/target readout — its own kiosk-defocus group (Task D.2):
            recedes when the fan slider is being dragged, and is itself the
            focused group while the target is being nudged (same signal as
            the nudge row below — a target nudge changes what this block
            shows, so the two stay in focus together). */}
        <div
          className="kiosk-defocus flex flex-wrap items-center justify-center gap-x-8 gap-y-4"
          data-kiosk-focused={targetControl.interacting ? "true" : undefined}
        >
          <div className="text-center">
            <div className="microlabel">Current</div>
            <div className="mt-1 font-mono text-4xl text-ink">{formatTemp(climate.currentTemp, climate.unit)}</div>
          </div>
          <div className="text-center">
            <div className="microlabel">Target</div>
            <div className="mt-1 font-mono text-3xl text-accent">
              {dualSetpoint ? (
                // A two-value range with a dash is not a dial — stays plain
                // text, same as the tile's own dual-setpoint branch.
                `${formatTemp(climate.targetTempLow, climate.unit)} – ${formatTemp(climate.targetTempHigh, climate.unit)}`
              ) : (
                // Same held value the tile renders (targetControl is the
                // tile's own hook instance, threaded through as a prop) —
                // the modal must never read climate.targetTemp directly, or
                // it would show the exact stomped-then-stale number this
                // hook exists to hide. Reel, not plain text, for the same
                // reason the tile uses one: this is the number you turn.
                <KioskDigitReel
                  text={formatTemp(targetControl.displayTarget, climate.unit)}
                  direction={targetControl.reelDirection}
                />
              )}
            </div>
          </div>
        </div>

        {nudgeable && (
          <div
            className="kiosk-defocus mt-6 flex items-center justify-center gap-4"
            data-kiosk-focused={targetControl.interacting ? "true" : undefined}
          >
            <button
              type="button"
              aria-label={`Lower target temperature for ${climate.name}`}
              disabled={pending || (!dualSetpoint && targetControl.lowerDisabled)}
              onClick={() => (dualSetpoint ? onNudge(-NUDGE_STEP) : targetControl.bump(-1))}
              className="kiosk-press flex h-[72px] w-[72px] items-center justify-center rounded-tile font-mono text-2xl text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              aria-label={`Raise target temperature for ${climate.name}`}
              disabled={pending || (!dualSetpoint && targetControl.raiseDisabled)}
              onClick={() => (dualSetpoint ? onNudge(NUDGE_STEP) : targetControl.bump(1))}
              className="kiosk-press flex h-[72px] w-[72px] items-center justify-center rounded-tile font-mono text-2xl text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}

        <ModeChipGroup
          title="Mode"
          groupLabel={`${climate.name} mode`}
          options={climate.hvacModes}
          current={shownModes.hvacMode}
          pending={pending}
          displayLabel={(mode) => HVAC_LABEL[mode] ?? mode}
          ariaLabel={(mode) => `Set ${climate.name} to ${HVAC_LABEL[mode] ?? mode} mode`}
          onSelect={onSetMode}
          className="kiosk-defocus"
        />

        {/* Fan/preset/swing (work item 2/3): only rendered when THIS entity's
            own attributes actually offer them — most climate entities in the
            world don't, and a control for a mode that doesn't exist would
            just fail against HA every time it's tapped.
            Fan speed is a SLIDER when the unit's modes are an ordered level
            ladder with Auto last (see isLevelLadder) and the same chip row as
            everything else when they aren't. */}
        {isLevelLadder(fanModes) ? (
          <FanSpeedSlider
            title="Fan speed"
            groupLabel={`${climate.name} fan speed`}
            options={fanModes}
            current={shownModes.fanMode}
            pending={pending}
            onSelect={onSetFanMode}
            className="kiosk-defocus"
            focused={fanDragging}
            onDraggingChange={setFanDragging}
          />
        ) : (
          <ModeChipGroup
            title="Fan speed"
            groupLabel={`${climate.name} fan speed`}
            options={fanModes}
            current={shownModes.fanMode}
            pending={pending}
            displayLabel={(mode) => mode}
            ariaLabel={(mode) => `Set ${climate.name} fan speed to ${mode}`}
            onSelect={onSetFanMode}
            className="kiosk-defocus"
          />
        )}

        <ModeChipGroup
          title="Preset"
          groupLabel={`${climate.name} preset`}
          options={climate.presetModes ?? []}
          current={shownModes.presetMode}
          pending={pending}
          displayLabel={(mode) => titleCase(mode)}
          ariaLabel={(mode) => `Set ${climate.name} preset to ${mode}`}
          onSelect={onSetPresetMode}
          className="kiosk-defocus"
        />

        <ModeChipGroup
          title="Swing"
          groupLabel={`${climate.name} swing`}
          options={climate.swingModes ?? []}
          current={shownModes.swingMode}
          pending={pending}
          displayLabel={(mode) => titleCase(mode)}
          ariaLabel={(mode) => `Set ${climate.name} swing to ${mode}`}
          onSelect={onSetSwingMode}
          className="kiosk-defocus"
        />

        {error && (
          <div role="alert" className="mt-4 text-center text-2xs text-bad">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
