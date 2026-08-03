"use client";

/* THESIS: replaces the old boxed ClimateCard with a borderless, distance-
   legible row (redesign-06 §B) — a wall panel read from 2-3m needs the
   current/target numbers to carry the hierarchy, not a bordered card. Advanced
   controls (HVAC mode, dual setpoint) that don't need to be visible at a
   glance move into a full-screen modal reachable from a single icon button,
   keeping the resting row down to one line per room.

   OWN-WORLD: mirrors kiosk-hub.tsx's own composition choice (THESIS there) —
   this file owns NUDGE_STEP/HVAC_LABEL/formatTemp as its own copies rather
   than importing from ha-climate.tsx (the authenticated /smarthome twin),
   because the two surfaces are intentionally allowed to drift (public kiosk
   vs. authenticated dashboard). The one exception is `UseKioskHaResult`,
   imported as a type-only from kiosk-hub.tsx — duplicating that shape would
   risk the optimistic-update contract silently drifting between the hook and
   its consumer. */

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
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
  return `${v.toFixed(1)}°${unit ?? ""}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Shared visual for every 56px row control (−, +, advanced) — borderless at
// rest, a hairline ring only on hover/active/focus so the row reads as open
// ground rather than a cluster of buttons (redesign-06 ban on decorative
// chrome).
const ROW_BUTTON =
  "flex h-14 w-14 shrink-0 items-center justify-center rounded-tile font-mono text-lg text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";

/* ── row ─────────────────────────────────────────────────────────────────── */

export function KioskClimateRow({
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
  const nudgeable = climate.available && (climate.targetTemp != null || dualSetpoint);

  // Unchanged from the old ClimateCard: hvac mode set and the temp nudge both
  // build a full optimistic HaEntities snapshot (mapping over entities.climates)
  // and hand it to ha.runAction, which flips it in immediately and rolls back
  // on failure. The modal and the row share these two functions rather than
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

  // Focus returns to the button that opened the modal, not document body —
  // same rationale as KioskPinPad's own restore-on-unmount effect.
  const closeModal = () => {
    setModalOpen(false);
    advancedButtonRef.current?.focus();
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0", !climate.available && "opacity-60")}>
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-ink">{climate.name}</span>
          {!climate.available && <span className="microlabel !text-warn shrink-0">unavailable</span>}
        </div>
      </div>

      {/* Distance-readable figure — the number a person 2-3m away actually
          needs, sized well above the old card's text-lg. */}
      <div className="font-mono text-3xl text-ink">{formatTemp(climate.currentTemp, climate.unit)}</div>

      <div className="text-center">
        {/* Error replaces the "Target" microlabel in place rather than
            adding a stacked line — the row must not grow or rewrap when a
            nudge fails. Same string the modal shows; the two are never on
            screen together (see the modal's fixed inset-0 backdrop, which
            fully occludes this row while open), so there's no duplicate
            announcement, just one visible location per state. */}
        {error ? (
          <div role="alert" title={error} className="microlabel !text-bad max-w-32 truncate">
            {error}
          </div>
        ) : (
          <div className="microlabel">Target</div>
        )}
        <div className="mt-0.5 font-mono text-xl text-accent">
          {dualSetpoint
            ? `${formatTemp(climate.targetTempLow, climate.unit)}–${formatTemp(climate.targetTempHigh, climate.unit)}`
            : formatTemp(climate.targetTemp, climate.unit)}
        </div>
      </div>

      {nudgeable && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Lower target temperature for ${climate.name}`}
            disabled={pending}
            onClick={() => nudge(-NUDGE_STEP)}
            className={ROW_BUTTON}
          >
            −
          </button>
          <button
            type="button"
            aria-label={`Raise target temperature for ${climate.name}`}
            disabled={pending}
            onClick={() => nudge(NUDGE_STEP)}
            className={ROW_BUTTON}
          >
            +
          </button>
        </div>
      )}

      <button
        ref={advancedButtonRef}
        type="button"
        disabled={!climate.available}
        aria-label={`Advanced controls for ${climate.name}`}
        onClick={() => setModalOpen(true)}
        className={ROW_BUTTON}
      >
        <SlidersHorizontal size={18} aria-hidden />
      </button>

      {modalOpen && (
        <KioskClimateModal
          climate={climate}
          pending={pending}
          error={error}
          dualSetpoint={dualSetpoint}
          nudgeable={nudgeable}
          onNudge={nudge}
          onSetMode={setMode}
          onClose={closeModal}
        />
      )}
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
  onClose,
}: {
  climate: HaClimate;
  pending: boolean;
  error?: string;
  dualSetpoint: boolean;
  nudgeable: boolean;
  onNudge: (delta: number) => void;
  onSetMode: (mode: string) => void;
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
                : formatTemp(climate.targetTemp, climate.unit)}
            </div>
          </div>
        </div>

        {nudgeable && (
          <div className="mt-6 flex items-center justify-center gap-4">
            <button
              type="button"
              aria-label={`Lower target temperature for ${climate.name}`}
              disabled={pending}
              onClick={() => onNudge(-NUDGE_STEP)}
              className="flex h-[72px] w-[72px] items-center justify-center rounded-tile font-mono text-2xl text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              aria-label={`Raise target temperature for ${climate.name}`}
              disabled={pending}
              onClick={() => onNudge(NUDGE_STEP)}
              className="flex h-[72px] w-[72px] items-center justify-center rounded-tile font-mono text-2xl text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}

        {climate.hvacModes.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2" role="group" aria-label={`${climate.name} mode`}>
            {climate.hvacModes.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={climate.hvacMode === mode}
                aria-label={`Set ${climate.name} to ${HVAC_LABEL[mode] ?? mode} mode`}
                disabled={pending}
                onClick={() => onSetMode(mode)}
                className={cn(
                  "h-14 min-w-[4.5rem] rounded-md border px-3 text-xs font-medium outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
                  climate.hvacMode === mode
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-line text-ink-dim hover:bg-panel hover:text-ink",
                )}
              >
                {HVAC_LABEL[mode] ?? mode}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 text-center text-2xs text-bad">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
