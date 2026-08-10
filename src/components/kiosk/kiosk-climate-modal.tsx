"use client";

/**
 * The climate detail modal and its control groups, extracted from
 * kiosk-climate.tsx. See that file for the tile this opens from.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { HaClimate } from "@/lib/types/ha";
import { cn } from "@/lib/utils";
import { KioskDigitReel } from "@/components/kiosk/kiosk-digits";
import {
  KIOSK_POP_MS,
  KIOSK_EASE_OUT,
  containerCollapse,
  containerExpand,
  prefersReducedMotion,
} from "@/lib/kiosk-motion";
import { NUDGE_STEP, type TargetControl } from "@/lib/kiosk/climate-controls";
import { HVAC_LABEL, formatTemp, titleCase } from "@/components/kiosk/kiosk-climate-shared";

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

export function KioskClimateModal({
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
  originRect,
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
  /** The tile's rect at the moment the expand button was tapped — the modal
   *  grows out of it and collapses back into it (containerExpand /
   *  containerCollapse). Null falls back to the plain centered pop, which
   *  stays the entrance for any caller with no tap to grow from. */
  originRect: DOMRect | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedRef = useRef(false);
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  // onClose must fire exactly once even though the collapse path arms both
  // an animation-finished handler and a wall-clock safety net (see
  // requestClose) — and never twice on a double-dismiss (Escape then
  // backdrop tap in the same beat).
  const closeFiredRef = useRef(false);
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

  // Container-transform entrance: the panel grows out of the tile's rect
  // instead of popping in place. Layout effect, not effect — the WAAPI call
  // must start before this mount's first paint, or the full-size panel
  // flashes for a frame at rest before snapping down to the tile to begin
  // its travel. Under reduced motion containerExpand returns null and the
  // panel simply appears at rest — same instant-show contract as the pop
  // path. The backdrop is untouched by this: its fade rides the `entered`
  // flip above either way.
  useLayoutEffect(() => {
    const node = dialogRef.current;
    const anim = originRect && node ? containerExpand(node, originRect) : null;
    // Cancelling on cleanup is not for the real unmount (the entrance is
    // long finished by then) — it's for dev StrictMode's mount→cleanup→
    // remount probe. Without it the second run measures the panel THROUGH
    // the first animation's frame-0 transform (the panel sitting shrunk on
    // the trigger rect), derives an identity FLIP, and replaces the whole
    // travel with a plain fade — measured on the test stack, not
    // hypothetical. Cancel puts the panel back at rest so the re-run
    // measures the true resting rect.
    return () => anim?.cancel();
    // Mount-only by design: originRect is fixed for the life of one open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Exit plays the reverse transition before actually unmounting (the parent
  // keeps `modalOpen` true until this fires `onClose`), so a tap-to-close
  // doesn't just vanish the panel. With an originRect it collapses back into
  // the tile it grew from; without one it keeps the plain fade+shrink.
  function requestClose() {
    if (closing) return;
    if (reducedRef.current) {
      onClose();
      return;
    }
    setClosing(true);

    const node = dialogRef.current;
    if (originRect && node) {
      const fireClose = () => {
        if (closeFiredRef.current) return;
        closeFiredRef.current = true;
        onClose();
      };
      const anim = containerCollapse(node, originRect);
      if (anim) {
        anim.finished.catch(() => {}).finally(fireClose);
        // Safety net: `finished` never resolves if the animation is cancelled
        // by an unmount race — the modal must not become undismissable.
        window.setTimeout(fireClose, KIOSK_POP_MS + 80);
        return;
      }
    }
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
        // With an originRect, WAAPI owns the panel's entrance and exit
        // (containerExpand/-Collapse composite over inline style), so the
        // inline style holds constant resting values and the CSS transition
        // never fires — the pop-path ternaries below are the no-origin
        // fallback only.
        style={
          originRect
            ? { ...transitionStyle, opacity: 1, transform: "none" }
            : { ...transitionStyle, opacity: shown ? 1 : 0, transform: shown ? "scale(1)" : "scale(0.96)" }
        }
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
