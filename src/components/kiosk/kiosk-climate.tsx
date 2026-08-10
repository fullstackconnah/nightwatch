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
import { Power, SlidersHorizontal } from "lucide-react";
import type { HaClimate, HaEntities } from "@/lib/types/ha";
import type { UseKioskHaResult } from "@/components/kiosk/kiosk-hub";
import { cn } from "@/lib/utils";
import { KioskDigitReel } from "@/components/kiosk/kiosk-digits";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import {
  NUDGE_STEP,
  preferredOnMode,
  readLastModes,
  writeLastMode,
  useModeHolds,
  useTargetControl,
} from "@/lib/kiosk/climate-controls";
import {
  EXPAND_BUTTON,
  EXPAND_BUTTON_CHIP,
  NUDGE_BUTTON,
  POWER_BUTTON,
  POWER_BUTTON_CHIP,
  formatTemp,
  formatTempRange,
} from "@/components/kiosk/kiosk-climate-shared";
import { KioskClimateModal } from "@/components/kiosk/kiosk-climate-modal";

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
  // The modal grows out of THIS TILE's rect (container transform, see
  // containerExpand in kiosk-motion.ts) — the tile is the container the user
  // perceives as becoming the modal, not the small expand button they
  // physically hit. Captured at TAP time, never at render: a rect captured
  // earlier goes stale the moment the grid relayouts (glance⇄full, a sibling
  // tile unmounting) and the modal would expand out of a position the tile
  // no longer occupies.
  const [modalOrigin, setModalOrigin] = useState<DOMRect | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
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
    <>
    <div
      ref={tileRef}
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
      // .kiosk-defocus` rule applies to its unfocused siblings. (The modal
      // used to rely on this exemption too, back when it rendered inside
      // this tile — it lives outside the tile root now, see the comment at
      // its render site below.)
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
        onClick={() => {
          setModalOrigin(tileRef.current?.getBoundingClientRect() ?? null);
          setModalOpen(true);
        }}
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

    </div>

    {/* OUTSIDE the tile root, deliberately: the tile is `isolate` (a real
        stacking context, required by the working-glow layer's -z-10), and a
        fixed dialog rendered inside a stacking context cannot escape it —
        its z-(--z-modal) becomes local, and every section later in the DOM
        (lights, switches) paints straight over the open modal. Measured on
        production 2026-08-06. A fragment sibling keeps the modal in this
        component (sharing the tile's holds/targetControl state, which is the
        whole reason it lives in this file) while letting position:fixed
        resolve against the viewport like every other kiosk modal. */}
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
        originRect={modalOrigin}
        onClose={closeModal}
      />
    )}
    </>
  );
}
