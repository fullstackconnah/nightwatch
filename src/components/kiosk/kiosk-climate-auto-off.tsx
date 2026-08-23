"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Moon, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIOSK_POP_MS, containerCollapse, containerExpand } from "@/lib/kiosk-motion";
import { parseTime, type AutoOffStatus } from "@/lib/climate-auto-off";
import type { UseClimateAutoOffResult } from "@/lib/kiosk/use-climate-auto-off";

const SAVE_DEBOUNCE_MS = 600;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function statusLine(status: AutoOffStatus | null, time: string): string {
  if (!status || status.kind === "off") return "Off — ACs are never turned off automatically.";
  if (status.kind === "done") return "Done for tonight.";
  if (status.kind === "skipped") return "Skipped tonight — resumes tomorrow.";
  return `Next sweep at ${time} — any AC still on turns off.`;
}

export function ClimateAutoOffPill({ autoOff }: { autoOff: UseClimateAutoOffResult }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<DOMRect | null>(null);
  const { state } = autoOff;
  if (!state) return null; // config not loaded yet — pill appears once known
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={
          state.enabled ? `AC auto-off at ${state.time} — change schedule` : "AC auto-off is off — configure"
        }
        onClick={() => {
          originRef.current = btnRef.current?.getBoundingClientRect() ?? null;
          setOpen(true);
        }}
        // -my-2.5 -mr-1: same "overflow without pushing layout" idiom as
        // kiosk-timers.tsx's close X (-mr-2.5 there). The 44px h-11 touch
        // target is a hard a11y floor and must not shrink, but this pill
        // sits inline with SectionHeader in ClimateSection's header row —
        // without the negative margin its full-height box would inflate that
        // row ~18px taller than every other section's header. The negative
        // vertical margin shrinks the button's margin box (what the flex row
        // measures) back down near SectionHeader's own line height while the
        // rendered 44px target still overflows the row invisibly above/below.
        className="kiosk-press -my-2.5 -mr-1 flex h-11 items-center gap-1.5 rounded-md px-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <Moon size={14} className={state.enabled ? "text-accent" : "text-ink-dim"} aria-hidden />
        <span
          className={cn("font-mono text-xs tabular-nums", state.enabled ? "text-accent" : "text-ink-dim")}
        >
          {state.enabled ? state.time : "off"}
        </span>
      </button>
      {open && (
        <ClimateAutoOffSheet autoOff={autoOff} onClose={() => setOpen(false)} originRect={originRef.current} />
      )}
    </>
  );
}

function ClimateAutoOffSheet({
  autoOff,
  onClose,
  originRect,
}: {
  autoOff: UseClimateAutoOffResult;
  onClose: () => void;
  originRect: DOMRect | null;
}) {
  const { state, status, update, skipTonight } = autoOff;
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const closeFiredRef = useRef(false);
  const [saveError, setSaveError] = useState(false);

  // Kept current every render so failure callbacks (which resolve well after
  // the render that started them) read the LATEST server value, not the one
  // closed over at call time — a stale closure here would re-sync to
  // whatever `state.time` was at the moment the request was fired, not what
  // it is now.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Local time while stepping; server state is the source of truth between
  // edits. Debounced POST so five fast taps are one write.
  const [localTime, setLocalTime] = useState(state?.time ?? "23:00");
  useEffect(() => {
    if (state) setLocalTime(state.time);
  }, [state]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  function step(field: "hour" | "minute", dir: 1 | -1) {
    const t = parseTime(localTime);
    if (!t) return;
    const next =
      field === "hour"
        ? `${pad2((t.hour + dir + 24) % 24)}:${pad2(t.minute)}`
        : `${pad2(t.hour)}:${pad2((t.minute + dir * 15 + 60) % 60)}`;
    setLocalTime(next);
    setSaveError(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void update({ time: next }).then((ok) => {
        setSaveError(!ok);
        // Failed save: the readout must not keep showing an unsaved time as
        // if it were live — drop back to whatever the server actually has.
        if (!ok && stateRef.current) setLocalTime(stateRef.current.time);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  // Same contract as kiosk-timers.tsx's overlay: focus the sheet's primary
  // control on open (the enable toggle — always rendered, never destructive,
  // unlike the "Skip tonight"/"Resume tonight" buttons which may or may not
  // be present), restore focus to the trigger on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstFocusRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // Container-transform entrance — see kiosk-motion.ts's containerExpand and
  // kiosk-timers.tsx's KioskTimersOverlay for the house pattern. Layout
  // effect, not effect: must commit before this mount's first paint, or the
  // full-size panel flashes at rest for a frame before snapping down to the
  // pill to begin its travel. No-op (containerExpand's own guard) under
  // reduced motion, and a no-op here too when there's no originRect.
  useLayoutEffect(() => {
    const node = dialogRef.current;
    const anim = originRect && node ? containerExpand(node, originRect) : null;
    // Cancel on cleanup — for dev StrictMode's mount→cleanup→remount probe,
    // not the real unmount: see KioskTimersOverlay's identical effect for the
    // measured failure (the re-run otherwise measures through the first
    // animation's frame-0 transform and flattens the FLIP into a fade).
    return () => anim?.cancel();
    // Mount-only: originRect is fixed for the life of one open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Routes every close path (Escape, backdrop click, X button) through one
  // place so each gets the same collapse-then-unmount behaviour. With no
  // originRect this is exactly today's `onClose()` — byte-identical, since
  // this overlay has no animation to skip in that case.
  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;

    // Flush a pending debounced time save instead of dropping it — a
    // tap-step-then-Escape/backdrop gesture inside the 600ms window is
    // normal, and the unmount cleanup below only clears the timer, it
    // doesn't fire it. Fire-and-forget: the sheet is on its way out, and
    // the pill re-renders from server state once the POST lands.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void update({ time: localTime });
    }

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
        // Safety net: `finished` never resolves if the animation is
        // cancelled by an unmount race — the sheet must not become
        // undismissable. containerCollapse itself already returns null
        // (skipped below) under reduced motion, so this only ever arms
        // when an animation is actually playing.
        window.setTimeout(fireClose, KIOSK_POP_MS + 80);
        return;
      }
    }
    onClose();
  }

  // Escape maps to the same requestClose the backdrop-click and X button
  // already use. Tab/Shift+Tab cycle within the dialog, same shape as
  // kiosk-timers.tsx's trap.
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
      // Nothing tabbable inside (shouldn't happen with real content, but the
      // container is tabIndex={-1} precisely so it has somewhere safe to land).
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

  if (!state) return null;
  const enabled = state.enabled;
  // No disabled:opacity-40 here — the wrapper around the stepper cluster
  // already applies opacity-40 when the schedule is off, and stacking a
  // second 0.4 multiplier on top of it compounds to ~0.16, well past what
  // the wrapper alone intends.
  const stepBtn =
    "kiosk-press flex h-11 w-11 items-center justify-center rounded-md border border-line text-ink outline-none hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 px-4 py-6 backdrop-blur-sm"
      onClick={requestClose}
      // Same gap as kiosk-timers.tsx's backdrop: a mousedown/touchdown that
      // doesn't resolve into a click on this same element (e.g. a drag that
      // ends elsewhere) still blurs focus to document.body without closing
      // anything, breaking the trap for the rest of the session. Blocking
      // the default pointerdown behavior covers that non-closing case
      // without touching the click-to-close path. target===currentTarget
      // scopes this to the scrim itself — pointerdown bubbles, and without
      // the guard a tap on a control inside the panel would have its own
      // default focus suppressed by this handler.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kiosk-auto-off-title"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="panel flex max-h-full w-full max-w-sm flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Moon size={15} className="text-accent" aria-hidden />
            <h2 id="kiosk-auto-off-title" className="text-sm font-semibold tracking-tight">
              AC auto-off
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="-mr-2.5 flex h-11 w-11 items-center justify-center rounded-md text-ink-dim outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-4 py-4">
          <button
            ref={firstFocusRef}
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => {
              setSaveError(false);
              void update({ enabled: !enabled }).then((ok) => {
                setSaveError(!ok);
                if (!ok && stateRef.current) setLocalTime(stateRef.current.time);
              });
            }}
            className={cn(
              "kiosk-press flex h-11 w-full items-center justify-between rounded-md border px-3 outline-none focus-visible:ring-1 focus-visible:ring-accent",
              enabled ? "border-accent-dim text-accent" : "border-line text-ink-dim",
            )}
          >
            <span className="text-sm font-semibold">Nightly auto-off</span>
            <span className="font-mono text-xs">{enabled ? "on" : "off"}</span>
          </button>

          <div className={cn("space-y-2", !enabled && "opacity-40")} aria-disabled={!enabled}>
            <span className="microlabel block">Sweep time</span>
            <div className="flex items-center justify-center gap-3">
              <div className="flex flex-col items-center gap-2">
                <button type="button" disabled={!enabled} onClick={() => step("hour", 1)} aria-label="Hour up" className={stepBtn}><Plus size={16} /></button>
                <button type="button" disabled={!enabled} onClick={() => step("hour", -1)} aria-label="Hour down" className={stepBtn}><Minus size={16} /></button>
              </div>
              <span className="font-mono text-3xl tabular-nums text-ink" aria-live="polite">{localTime}</span>
              <div className="flex flex-col items-center gap-2">
                <button type="button" disabled={!enabled} onClick={() => step("minute", 1)} aria-label="Minutes up" className={stepBtn}><Plus size={16} /></button>
                <button type="button" disabled={!enabled} onClick={() => step("minute", -1)} aria-label="Minutes down" className={stepBtn}><Minus size={16} /></button>
              </div>
            </div>
          </div>

          <p className="text-xs text-ink-dim">{statusLine(status, localTime)}</p>
          {status?.kind === "skipped" && (
            <button
              type="button"
              onClick={() => void update({ skipDate: null })}
              className="kiosk-press h-11 w-full rounded-md border border-line text-xs font-semibold text-ink outline-none hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent"
            >
              Resume tonight
            </button>
          )}
          {status?.kind === "scheduled" && (
            <button
              type="button"
              onClick={() => void skipTonight()}
              className="kiosk-press h-11 w-full rounded-md border border-line text-xs font-semibold text-ink outline-none hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent"
            >
              Skip tonight
            </button>
          )}
          {saveError && <p className="text-xs text-warn">Couldn't save — try again.</p>}
        </div>
      </div>
    </div>
  );
}

export function ClimateAutoOffBanner({ autoOff }: { autoOff: UseClimateAutoOffResult }) {
  const { warn, onCount, notice, skipTonight, state } = autoOff;
  if (notice) {
    return (
      <div role="status" className="panel flex flex-wrap items-center gap-2 px-4 py-3">
        <Moon size={14} className="text-warn" aria-hidden />
        <span className="microlabel !text-warn">Auto-off</span>
        <span className="text-xs text-ink-dim">{notice}</span>
      </div>
    );
  }
  if (!warn || onCount === 0 || !state) return null;
  return (
    <div role="status" className="panel flex flex-wrap items-center gap-2.5 px-4 py-2.5">
      <Moon size={14} className="text-accent" aria-hidden />
      <span className="microlabel">Auto-off</span>
      <span className="text-xs text-ink-dim">
        {onCount === 1 ? "1 AC" : `${onCount} ACs`} turning off at{" "}
        <span className="font-mono tabular-nums text-ink">{state.time}</span>
      </span>
      <button
        type="button"
        onClick={() => void skipTonight()}
        className="kiosk-press ml-auto h-11 rounded-md border border-line px-3 text-xs font-semibold text-ink outline-none hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent"
      >
        Skip tonight
      </button>
    </div>
  );
}
