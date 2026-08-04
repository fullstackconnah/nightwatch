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

// TODO(kiosk-motion): swap these for KIOSK_POP_MS / KIOSK_EASE_OUT /
// KIOSK_REDUCED_MS exported from src/lib/kiosk-motion.ts once agent A lands
// it (see docs/kiosk-analysis/redesign-06-space-and-modes.md "Motion tokens").
// Values match that contract's documented KIOSK_POP_MS so swapping later is a
// pure import change, not a behaviour change.
const MODAL_POP_MS = 260;
const MODAL_EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

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

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Shared visual for the 56px −/+ nudge buttons — borderless at rest, a
// hairline ring only on hover/active/focus so the cluster reads as open
// ground rather than a boxed control pair (redesign-06 ban on decorative
// chrome).
const NUDGE_BUTTON =
  "flex h-14 w-14 shrink-0 items-center justify-center rounded-tile font-mono text-lg text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";

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
const EXPAND_BUTTON =
  "group absolute -top-1.5 -right-1.5 flex h-14 w-14 items-center justify-center text-ink-dim outline-none transition hover:text-ink disabled:pointer-events-none disabled:opacity-40";

const EXPAND_BUTTON_CHIP =
  "flex h-9 w-9 items-center justify-center rounded-tile ring-1 ring-transparent transition group-hover:ring-line-bright group-focus-visible:ring-1 group-focus-visible:ring-accent group-active:scale-[0.98]";

/** Mirrors EXPAND_BUTTON on the opposite corner. Same 56px touch target, same
 *  negative offset so it overhangs the tile's own padding rather than stealing
 *  a column from the two rows of text between them, and the same invisible
 *  hit-area / inner-chip split (see EXPAND_BUTTON's comment). */
const POWER_BUTTON =
  "group absolute -top-1.5 -left-1.5 flex h-14 w-14 items-center justify-center outline-none disabled:pointer-events-none disabled:opacity-40";

const POWER_BUTTON_CHIP =
  "flex h-9 w-9 items-center justify-center rounded-tile ring-1 ring-transparent transition group-hover:ring-line-bright group-focus-visible:ring-1 group-focus-visible:ring-accent group-active:scale-[0.98]";

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
  }

  const displayTarget = pendingTarget ?? climate.targetTemp;
  return {
    displayTarget,
    lowerDisabled: displayTarget != null && displayTarget <= min,
    raiseDisabled: displayTarget != null && displayTarget >= max,
    bump,
  };
}

/* ── tile ────────────────────────────────────────────────────────────────── */

export function KioskClimateTile({
  ha,
  climate,
  entities,
}: {
  ha: UseKioskHaResult;
  climate: HaClimate;
  entities: HaEntities;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const advancedButtonRef = useRef<HTMLButtonElement>(null);

  const pending = ha.isPending(climate.entityId);
  const error = ha.actionErrors[climate.entityId];
  const dualSetpoint = climate.targetTempLow != null && climate.targetTempHigh != null;
  const isOn = climate.hvacMode !== "off";

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

  // Unchanged from the old ClimateCard: hvac mode set and the temp nudge both
  // build a full optimistic HaEntities snapshot (mapping over entities.climates)
  // and hand it to ha.runAction, which flips it in immediately and rolls back
  // on failure. The modal and the tile share these two functions rather than
  // each re-deriving the optimistic payload.
  const setMode = (mode: string) => {
    const next: HaEntities = {
      ...entities,
      climates: entities.climates.map((c) => (c.entityId === climate.entityId ? { ...c, hvacMode: mode } : c)),
    };
    void ha.runAction({ entityId: climate.entityId, action: "set_hvac_mode", hvacMode: mode }, next);
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

  // Same optimistic-snapshot shape as setMode above, one per newly-exposed
  // attribute (work item 2/3) — each is a one-shot absolute write, so none
  // of them need useTargetControl's hold/debounce machinery.
  const setFanMode = (mode: string) => {
    const next: HaEntities = {
      ...entities,
      climates: entities.climates.map((c) => (c.entityId === climate.entityId ? { ...c, fanMode: mode } : c)),
    };
    void ha.runAction({ entityId: climate.entityId, action: "set_fan_mode", fanMode: mode }, next);
  };

  const setPresetMode = (mode: string) => {
    const next: HaEntities = {
      ...entities,
      climates: entities.climates.map((c) => (c.entityId === climate.entityId ? { ...c, presetMode: mode } : c)),
    };
    void ha.runAction({ entityId: climate.entityId, action: "set_preset_mode", presetMode: mode }, next);
  };

  const setSwingMode = (mode: string) => {
    const next: HaEntities = {
      ...entities,
      climates: entities.climates.map((c) => (c.entityId === climate.entityId ? { ...c, swingMode: mode } : c)),
    };
    void ha.runAction({ entityId: climate.entityId, action: "set_swing_mode", swingMode: mode }, next);
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
        "relative flex flex-col items-center gap-2 rounded-tile border p-3 text-center transition-colors",
        // The SAME on-state vocabulary the light and switch pills already use
        // (kiosk-hub.tsx's ToggleChip): accent border, accent wash, accent
        // glyph. A climate unit that's running is the same kind of fact as a
        // lamp that's on, and it should not need its own colour language —
        // this pairing is also already contrast-checked across all 16 themes,
        // which a newly invented tint would not be.
        isOn ? "border-accent/40 bg-accent/10" : "border-line bg-panel-2",
        !climate.available && "opacity-60",
      )}
    >
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
            {dualSetpoint
              ? formatTempRange(climate.targetTempLow, climate.targetTempHigh, climate.unit)
              : // The held value (see useTargetControl) — NOT climate.targetTemp
                // directly, or a tap would show the exact stomped-then-stale
                // number this whole hook exists to fix.
                formatTemp(targetControl.displayTarget, climate.unit)}
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

/** Shared chip-row rendering for every mode picker in the modal (hvac, and
 *  now fan/preset/swing) — one visual language rather than a fifth control
 *  inventing its own. `flex-wrap` is load-bearing, not decorative: these
 *  units offer 7 fan levels + Auto, which overflows a single row at the
 *  modal's own max-w-md. Renders nothing when `options` is empty, which is
 *  what makes "only render a control group this entity actually advertises"
 *  true without every call site repeating the same length check. */
function ModeChipGroup({
  groupLabel,
  options,
  current,
  pending,
  displayLabel,
  ariaLabel,
  onSelect,
}: {
  groupLabel: string;
  options: string[];
  current?: string;
  pending: boolean;
  displayLabel: (mode: string) => string;
  ariaLabel: (mode: string) => string;
  onSelect: (mode: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-2" role="group" aria-label={groupLabel}>
      {options.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={current === mode}
          aria-label={ariaLabel(mode)}
          disabled={pending}
          onClick={() => onSelect(mode)}
          className={cn(
            "h-14 min-w-[4.5rem] rounded-md border px-3 text-xs font-medium outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
            current === mode
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-line text-ink-dim hover:bg-panel hover:text-ink",
          )}
        >
          {displayLabel(mode)}
        </button>
      ))}
    </div>
  );
}

/* ── modal ───────────────────────────────────────────────────────────────── */

function KioskClimateModal({
  climate,
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

  // Entrance: flip `entered` a frame after mount so the transition actually
  // animates from the initial (opacity 0, scale 0.96) style rather than
  // snapping straight to the end state. Skipped under reduced-motion, per the
  // redesign contract's "never nothing appears" rule — the modal still shows
  // up, just without the pop.
  useEffect(() => {
    reducedRef.current = prefersReducedMotion();
    dialogRef.current?.focus();
    if (reducedRef.current) {
      setEntered(true);
      return;
    }
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
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
    window.setTimeout(onClose, MODAL_POP_MS);
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
    transitionDuration: `${MODAL_POP_MS}ms`,
    transitionTimingFunction: MODAL_EASE_OUT,
  };

  return (
    <div
      aria-hidden={false}
      className="fixed inset-0 z-(--z-modal-backdrop) flex items-center justify-center bg-bg/90 px-4 backdrop-blur-sm transition-opacity motion-reduce:transition-none"
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
        className="panel relative z-(--z-modal) w-full max-w-md p-6 transition-[opacity,transform] motion-reduce:transition-none"
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

        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          <div className="text-center">
            <div className="microlabel">Current</div>
            <div className="mt-1 font-mono text-4xl text-ink">{formatTemp(climate.currentTemp, climate.unit)}</div>
          </div>
          <div className="text-center">
            <div className="microlabel">Target</div>
            <div className="mt-1 font-mono text-3xl text-accent">
              {dualSetpoint
                ? `${formatTemp(climate.targetTempLow, climate.unit)} – ${formatTemp(climate.targetTempHigh, climate.unit)}`
                : // Same held value the tile renders (targetControl is the
                  // tile's own hook instance, threaded through as a prop) —
                  // the modal must never read climate.targetTemp directly, or
                  // it would show the exact stomped-then-stale number this
                  // hook exists to hide.
                  formatTemp(targetControl.displayTarget, climate.unit)}
            </div>
          </div>
        </div>

        {nudgeable && (
          <div className="mt-6 flex items-center justify-center gap-4">
            <button
              type="button"
              aria-label={`Lower target temperature for ${climate.name}`}
              disabled={pending || (!dualSetpoint && targetControl.lowerDisabled)}
              onClick={() => (dualSetpoint ? onNudge(-NUDGE_STEP) : targetControl.bump(-1))}
              className="flex h-[72px] w-[72px] items-center justify-center rounded-tile font-mono text-2xl text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              aria-label={`Raise target temperature for ${climate.name}`}
              disabled={pending || (!dualSetpoint && targetControl.raiseDisabled)}
              onClick={() => (dualSetpoint ? onNudge(NUDGE_STEP) : targetControl.bump(1))}
              className="flex h-[72px] w-[72px] items-center justify-center rounded-tile font-mono text-2xl text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}

        <ModeChipGroup
          groupLabel={`${climate.name} mode`}
          options={climate.hvacModes}
          current={climate.hvacMode}
          pending={pending}
          displayLabel={(mode) => HVAC_LABEL[mode] ?? mode}
          ariaLabel={(mode) => `Set ${climate.name} to ${HVAC_LABEL[mode] ?? mode} mode`}
          onSelect={onSetMode}
        />

        {/* Fan/preset/swing (work item 2/3): only rendered when THIS entity's
            own attributes actually offer them — most climate entities in the
            world don't, and a control for a mode that doesn't exist would
            just fail against HA every time it's tapped. */}
        <ModeChipGroup
          groupLabel={`${climate.name} fan speed`}
          options={climate.fanModes ?? []}
          current={climate.fanMode}
          pending={pending}
          displayLabel={(mode) => mode}
          ariaLabel={(mode) => `Set ${climate.name} fan speed to ${mode}`}
          onSelect={onSetFanMode}
        />

        <ModeChipGroup
          groupLabel={`${climate.name} preset`}
          options={climate.presetModes ?? []}
          current={climate.presetMode}
          pending={pending}
          displayLabel={(mode) => titleCase(mode)}
          ariaLabel={(mode) => `Set ${climate.name} preset to ${mode}`}
          onSelect={onSetPresetMode}
        />

        <ModeChipGroup
          groupLabel={`${climate.name} swing`}
          options={climate.swingModes ?? []}
          current={climate.swingMode}
          pending={pending}
          displayLabel={(mode) => titleCase(mode)}
          ariaLabel={(mode) => `Set ${climate.name} swing to ${mode}`}
          onSelect={onSetSwingMode}
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
