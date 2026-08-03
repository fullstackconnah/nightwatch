"use client";

/* THESIS: the kiosk redesign's one merged surface (redesign-06 §5,
   docs/kiosk-analysis/redesign-06-space-and-modes.md — read that file's
   "mode model" and "structural rule" sections before touching this one).
   Glance and the old Standard layout are no longer two mutually exclusive
   trees chosen by a stored preference; they're two SHAPES of the same
   container. The clock, the current temperature, the forecast rail and the
   server/health line are the SAME DOM NODES in both modes — rendered once
   by the <header> below and registered with useFlipGroup(mode) — because a
   node that's mounted inside one subtree in glance and a different subtree
   in full is, to React, two different elements: it unmounts one and mounts
   the other, and FLIP has nothing to animate across that gap. Everything
   else (the weather sentence/briefing/tiles in glance, the hub/tools in
   full) is genuinely different content per mode and fades rather than
   travels.

   MODE STATE: `mode` ("glance" | "full") is owned here, not in page.tsx —
   it's runtime-only (never persisted; a fresh mount always rests in
   glance) and every signal that drives it (idle timeout, interaction,
   elevation, the stored layout preference, the alert overlay, the PIN/
   climate modals) is either already local to this component or arrives as
   a prop from page.tsx, which still owns the things that outlive a single
   mode transition (elevation, the PIN pad, night). Keeping it here also
   means the FLIP registry (keyed on `mode`) and the state that changes it
   live in the same file, rather than threading a mode value down through
   props just to hand it back up on every interaction. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFreshness, useKioskHealth } from "@/lib/kiosk-client";
import {
  KIOSK_FADE_MS,
  KIOSK_MOVE_MS,
  KIOSK_REDUCED_MS,
  prefersReducedMotion,
  useFlipGroup,
} from "@/lib/kiosk-motion";
import { KioskClock } from "@/components/kiosk-clock";
import { KioskForecastRail } from "@/components/kiosk-forecast";
import {
  KioskDisplay,
  useWeatherView,
  WEATHER_ICON,
  type KioskPeriod,
  type WeatherDay,
} from "@/components/kiosk-display";
import { KioskGlance } from "@/components/kiosk-glance";
import { KioskHub } from "@/components/kiosk-hub";
import { KioskVoicePanel } from "@/components/kiosk-voice";
import { KioskAppearance, type KioskLayoutChoice } from "@/components/kiosk-appearance";
import { KioskAdminPanel } from "@/components/kiosk-admin-panel";
import { KioskAlerts } from "@/components/kiosk-alerts";
import { KioskStatusStripExtras } from "@/components/kiosk-status-strip";
import { StaleTag } from "@/components/kiosk-stale-tag";

type KioskViewMode = "glance" | "full";

// 30s of no interaction returns to glance — the contract's number, not a
// tuned guess.
const KIOSK_IDLE_MS = 30_000;
const HEALTH_POLL_MS = 15_000;

/* ── modal watcher ─────────────────────────────────────────────────────────
   kiosk-climate.tsx's advanced-controls modal (owned by agent B) has no
   prop or callback surfacing "am I open", and threading one through
   kiosk-hub.tsx is out of this workstream's scope. It, and kiosk-pin-pad.tsx's
   dialog, both already self-mark `aria-modal="true"` as part of the ordinary
   WAI-ARIA dialog contract (not a kiosk-specific convention) — watching for
   that attribute anywhere in the document is a zero-coupling way to detect
   "some modal is open" without reaching into either component's internals
   or adding a prop that would leak an implementation detail across an
   ownership boundary. It also naturally covers both suspensions the
   contract asks for (PIN pad open, climate modal open) with one signal. */
function useDomModalOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const check = () => setOpen(document.querySelector('[aria-modal="true"]') !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-modal"],
    });
    return () => observer.disconnect();
  }, []);
  return open;
}

/* ── mode state machine ──────────────────────────────────────────────────── */

/** `pinned` (layout === "standard", or elevated — admin work needs the hub)
 *  short-circuits the mode outright; `suspended` just pauses the idle timer
 *  so a mid-task person is never yanked back to the clock, without forcing
 *  a mode itself. Unsuspending always arms a FULL fresh 30s window rather
 *  than resuming wherever a background timer had gotten to — closing a
 *  climate modal you'd been reading for two minutes shouldn't immediately
 *  drop you back to glance. */
function useKioskMode(pinned: boolean, suspended: boolean, initial: KioskViewMode) {
  const [viewMode, setViewMode] = useState<KioskViewMode>(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setViewMode("glance"), KIOSK_IDLE_MS);
  }, []);

  useEffect(() => {
    if (pinned || suspended) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    arm();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pinned, suspended, arm]);

  const onInteraction = useCallback(() => {
    setViewMode("full");
    if (!pinned && !suspended) arm();
  }, [pinned, suspended, arm]);

  // A document-level listener, not a React onKeyDown on the surface's root —
  // a keydown only bubbles through an element that's an ANCESTOR of whatever
  // currently has focus. On a kiosk nothing is usually focused (focus sits on
  // document.body, an ancestor of this whole tree, not a descendant of it),
  // so a plain onKeyDown here would silently miss most key presses. Same
  // document-listener idiom kiosk-alerts.tsx already uses for its own
  // Escape handling.
  useEffect(() => {
    document.addEventListener("keydown", onInteraction);
    return () => document.removeEventListener("keydown", onInteraction);
  }, [onInteraction]);

  return { mode: pinned ? "full" : viewMode, onInteraction } as const;
}

/** Timing + which mode's content is actually mounted for the non-shared
 *  blocks (contract: fades out BEFORE the shared elements land, fades in
 *  AFTER; total ≤600ms). `mode` itself flips immediately — it drives the
 *  header's shape and the FLIP key, and the shared elements start
 *  travelling on that same frame. `displayMode` here lags behind it on the
 *  way out: the outgoing block stays mounted at opacity-0 for KIOSK_FADE_MS
 *  (overlapping the start of the shared elements' travel, per the mirror's
 *  note that overlap reads better than a same-frame pop) before it's
 *  actually swapped for the incoming one, the same held-mounted/timed-
 *  unmount pattern kiosk-climate.tsx's modal already uses for its own
 *  entered/closing pair.
 *
 *  Sequence from t=0 (mode changes):
 *   - [0, FADE_MS]        outgoing content (displayMode, unchanged) fades
 *                         to opacity-0 while the shared elements begin
 *                         their MOVE_MS travel underneath it.
 *   - FADE_MS             outgoing content unmounts; displayMode flips to
 *                         `mode`; incoming content mounts at opacity-0.
 *   - [FADE_MS, MOVE_MS]  incoming content stays invisible — the shared
 *                         elements are still travelling.
 *   - MOVE_MS             shared elements have landed; incoming content
 *                         starts its own FADE_MS fade-in.
 *   - MOVE_MS + FADE_MS   done. (420 + 180 = 600ms, the contract's cap.)
 *
 *  Reduced motion skips the wait and crossfades immediately at
 *  KIOSK_REDUCED_MS (register() itself already no-ops the shared-element
 *  travel under reduced motion, so there's nothing to wait for).
 *
 *  Every effect run clears whatever timers are in flight and re-evaluates
 *  from scratch, so a rapid glance→full→glance re-flip mid-transition can't
 *  strand a ghost block: if `mode` reverts to match whatever's still
 *  actually mounted (`displayMode`), the pending exit is simply cancelled
 *  and the content snaps back to visible instead of continuing to fade
 *  toward a target that's no longer wanted. */
function useModeContent(mode: KioskViewMode) {
  const [displayMode, setDisplayMode] = useState(mode);
  const [phase, setPhase] = useState<"idle" | "exiting" | "entering">("idle");
  const reducedRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    reducedRef.current = prefersReducedMotion();
  }, []);

  useEffect(() => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);

    if (mode === displayMode) {
      // Already showing the right content — including the "rapid flip
      // reverted mid-fade-out" case, which lands here because `displayMode`
      // never actually changed yet. Cancel back to visible.
      setPhase("idle");
      return;
    }

    if (reducedRef.current) {
      setDisplayMode(mode);
      setPhase("idle");
      return;
    }

    setPhase("exiting");
    exitTimerRef.current = setTimeout(() => {
      setDisplayMode(mode);
      setPhase("entering");
      enterTimerRef.current = setTimeout(() => setPhase("idle"), KIOSK_MOVE_MS - KIOSK_FADE_MS);
    }, KIOSK_FADE_MS);

    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    };
  }, [mode, displayMode]);

  return {
    displayMode,
    visible: phase === "idle",
    durationMs: reducedRef.current ? KIOSK_REDUCED_MS : KIOSK_FADE_MS,
  };
}

/* ── shared header pieces ────────────────────────────────────────────────── */

function TempNode({
  mode,
  weather,
  registerRef,
}: {
  mode: KioskViewMode;
  weather: ReturnType<typeof useWeatherView>;
  registerRef: (node: HTMLElement | null) => void;
}) {
  const current = weather.ok?.current ?? null;
  const full = mode === "full";
  // Kept mounted (empty) rather than conditionally rendered even with no
  // reading yet — a FLIP-registered node has to exist across the mode
  // change for the registry to have anything to measure.
  if (!current) return <div ref={registerRef} />;
  const Icon = WEATHER_ICON[current.code];
  return (
    <div
      ref={registerRef}
      className={cn("flex flex-wrap items-center gap-3", full ? "text-ink" : "max-w-full justify-center text-ink")}
    >
      <Icon size={full ? 18 : 28} className="shrink-0 text-ink-dim" aria-hidden />
      <span
        className={cn(
          "shrink-0 font-mono tabular-nums",
          full ? "text-xl" : "text-4xl min-[420px]:text-5xl md:text-6xl",
        )}
      >
        {Math.round(current.tempC)}°
      </span>
      <span
        className={cn(
          "truncate text-ink-dim",
          full ? "text-sm" : "max-w-full text-xl min-[420px]:text-2xl md:text-3xl",
        )}
      >
        {current.label.toLowerCase()}
      </span>
      {weather.status === "ready-stale" && <span className="shrink-0 microlabel !text-warn">stale</span>}
    </div>
  );
}

function ServerLine({ mode, registerRef }: { mode: KioskViewMode; registerRef: (node: HTMLElement | null) => void }) {
  const health = useFreshness(useKioskHealth(HEALTH_POLL_MS));
  const full = mode === "full";

  if (health.status === "unreachable-empty") {
    return full ? (
      <div ref={registerRef} className="flex items-center gap-1.5 font-mono text-xs text-bad">
        <ShieldAlert size={13} aria-hidden />
        container health unreachable
      </div>
    ) : (
      <div ref={registerRef} className="text-base text-ink-dim">
        server status unreachable
      </div>
    );
  }

  // Loading: keep the node alive (see TempNode's comment) with nothing to
  // report yet.
  if (!health.data) return <div ref={registerRef} />;

  // Dead/unhealthy counts intentionally aren't announced here in either
  // mode (a judgement call, see kiosk-status-strip.tsx's THESIS): the alert
  // surface (kiosk-alerts.tsx, sourced from the same src/lib/attention.ts
  // probes) already owns that signal via the takeover/badge/tray, so this
  // line stays a plain running-count reading rather than a second, quieter
  // echo of the same fact.
  return full ? (
    <div ref={registerRef} className="flex items-center gap-1.5 font-mono text-xs text-ink-dim">
      <span className="dot dot-running" aria-hidden />
      {health.data.running}
      <span className="microlabel">running</span>
      {health.status === "ready-stale" && <StaleTag />}
    </div>
  ) : (
    <div ref={registerRef} className="text-base text-ink-dim">
      <span className="font-mono tabular-nums">{health.data.running}</span> running
      {health.status === "ready-stale" && <span className="microlabel !text-warn ml-2">stale</span>}
    </div>
  );
}

/* ── scroll-shadow affordance ────────────────────────────────────────────── */
// redesign-06 follow-up (2026-08-03), P0 fix 1: full mode targets zero
// vertical overflow at 1024×768/1180×820, and every other lever here (chip
// rows instead of tile grids, tighter row/section padding, climate moved
// above the fold) goes toward that. But a wall panel with several climate
// rooms plus a full switch bank is enough real content that the target isn't
// always reachable without breaking the 56px touch floor or the distance-
// legibility bar — the contract's own escape hatch: "if some content
// genuinely cannot fit ... a real affordance (a fade/scroll-shadow at the
// cut, not a bare cut)". This is that affordance, not a substitute for
// fitting — it only ever shows when the page has genuinely overflowed.
function useBottomScrollShadow(active: boolean): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const check = () => {
      const doc = document.documentElement;
      const overflow = doc.scrollHeight - doc.clientHeight;
      const atBottom = overflow - window.scrollY <= 2;
      setShow(overflow > 2 && !atBottom);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    // Hub/climate content resizes from SWR polls landing, not just user
    // scroll/resize — a light poll catches "the page just grew/shrank under
    // the shadow" without wiring a ResizeObserver through every section.
    const id = setInterval(check, 2000);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      clearInterval(id);
    };
  }, [active]);
  return show;
}

/* ── the surface ─────────────────────────────────────────────────────────── */

export function KioskSurface({
  period,
  layout,
  onLayoutChange,
  elevated,
  expiresAt,
  onAdminClick,
  onLock,
  initialMode,
}: {
  period: KioskPeriod;
  layout: KioskLayoutChoice;
  onLayoutChange: (next: KioskLayoutChoice) => void;
  elevated: boolean;
  expiresAt: number | null;
  onAdminClick: () => void;
  onLock: () => void;
  /** Seeds the very first render only (a night wake tap enters full — see
   *  page.tsx's wakeNight/nightWoken — everything else always rests in
   *  glance on mount, per the contract). */
  initialMode?: KioskViewMode;
}) {
  const [alertOverlayOpen, setAlertOverlayOpen] = useState(false);
  const modalOpenDom = useDomModalOpen();
  // Elevation is handled as a pin (forces "full" outright, below) rather
  // than folded into `suspended`: the mode musn't just pause its return
  // while elevated, it must actually BE full the instant elevation starts
  // (admin work needs the hub), not whatever glance/full it happened to be
  // showing when the PIN was entered.
  const suspended = modalOpenDom || alertOverlayOpen;
  const pinned = layout === "standard" || elevated;
  const { mode, onInteraction } = useKioskMode(pinned, suspended, initialMode ?? "glance");

  const flip = useFlipGroup(mode);
  const { displayMode, visible, durationMs } = useModeContent(mode);
  const weather = useWeatherView();
  // `full` drives the header's shape + FLIP timing (flips immediately).
  // `contentFull` drives WHICH non-shared content is mounted (lags on the
  // way out — see useModeContent) so the outgoing block gets its fade
  // before it's actually swapped for the incoming one.
  const full = mode === "full";
  const contentFull = displayMode === "full";

  const days: WeatherDay[] = weather.ok?.days ?? [];
  const showBottomShadow = useBottomScrollShadow(full);

  return (
    <div
      onPointerDown={onInteraction}
      className={cn("flex flex-col", full ? "gap-3" : "min-h-[calc(100vh-2rem)] items-center justify-center gap-10 px-6 text-center")}
    >
      {/* Fixed overlay, outside the flow — mounted here per the contract's
          ownership map (agent D mounts it), built by agent A. */}
      <KioskAlerts onOverlayStateChange={setAlertOverlayOpen} />

      {/* Scroll-shadow affordance — see useBottomScrollShadow above. Sits
          below the sticky header's own z-layer and above ordinary content;
          pointer-events-none so it never intercepts a tap meant for the
          hub beneath it. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-(--z-sticky) h-16 bg-gradient-to-t from-bg to-transparent transition-opacity motion-reduce:transition-none",
          showBottomShadow ? "opacity-100" : "opacity-0",
        )}
        style={{ transitionDuration: `${KIOSK_FADE_MS}ms` }}
      />

      {/* THE shared container — same clock/temp/forecast/server-line nodes
          in both modes, only the wrapping classes (and the full-only extras
          nested inside) change. */}
      <header
        data-mode={mode}
        className={cn(
          full
            ? "panel sticky top-0 z-(--z-sticky) flex flex-row flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:py-3"
            : "flex flex-col items-center gap-5",
        )}
      >
        <KioskClock ref={flip.register("clock")} size={full ? "full" : "glance"} />
        <TempNode mode={mode} weather={weather} registerRef={flip.register("temp")} />
        {/* `basis-full` in full mode only: this rail's own day-drop
            breakpoints (kiosk-forecast.tsx) are viewport-width media
            queries written assuming the rail owns the full page width. As a
            plain flex-wrap item sharing a row with the clock/temp/server-
            line/extras it could get squeezed into a much narrower box than
            that while a wide breakpoint still asks it to show 5 days —
            basis-full forces it onto its own line (pushing whatever's after
            it in source order to the next line too), restoring the width
            assumption its breakpoints were written against. Glance's header
            is a flex-col already, where basis-full is a no-op. */}
        <div ref={flip.register("forecast")} className={cn(full && "basis-full")}>
          {days.length > 0 && (
            <KioskForecastRail
              days={days}
              emphasizeIndex={period === "evening" ? 1 : null}
              size={full ? "full" : "glance"}
            />
          )}
        </div>
        <ServerLine mode={mode} registerRef={flip.register("server-line")} />

        {contentFull && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <KioskStatusStripExtras
              elevated={elevated}
              onAdminClick={onAdminClick}
              revealed={visible}
              durationMs={durationMs}
            />
          </div>
        )}
      </header>

      <RevealBlock revealed={visible} durationMs={durationMs} stack={!contentFull}>
        {contentFull ? (
          <FullContent
            period={period}
            elevated={elevated}
            expiresAt={expiresAt}
            layout={layout}
            onLayoutChange={onLayoutChange}
            onLock={onLock}
          />
        ) : (
          <KioskGlance period={period} onAdminClick={onAdminClick} />
        )}
      </RevealBlock>
    </div>
  );
}

/** Wraps the mode's non-shared content in the fade the contract asks for.
 *  Deliberately a real box, not `display: contents` — `contents` generates
 *  no box of its own, and `opacity` has no visual effect on an element
 *  without one, which would silently no-op this whole fade. `stack` (glance
 *  only) recreates the gap-10 rhythm the surface's own flex column would
 *  have given these children directly, since they're now one nesting level
 *  deeper inside this wrapper; full's content is already one cohesive block
 *  (FullContent's own root div), so it needs no extra layout here. */
function RevealBlock({
  revealed,
  durationMs,
  stack,
  children,
}: {
  revealed: boolean;
  durationMs: number;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "transition-opacity ease-out motion-reduce:transition-none",
        stack && "flex flex-col items-center gap-10",
        revealed ? "opacity-100" : "opacity-0",
      )}
      style={{ transitionDuration: `${durationMs}ms` }}
    >
      {children}
    </div>
  );
}

/** The old "standard" branch of page.tsx, unchanged in substance — the hub,
 *  elevated tools and weather/briefing band, now living inside the surface
 *  instead of being one of two top-level trees page.tsx chose between. */
function FullContent({
  period,
  elevated,
  expiresAt,
  layout,
  onLayoutChange,
  onLock,
}: {
  period: KioskPeriod;
  elevated: boolean;
  expiresAt: number | null;
  layout: KioskLayoutChoice;
  onLayoutChange: (next: KioskLayoutChoice) => void;
  onLock: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3">
      <KioskDisplay period={period} />

      {elevated && expiresAt !== null && (
        <div className="flex flex-col items-center gap-4">
          <KioskVoicePanel />
          <KioskAppearance layout={layout} onLayoutChange={onLayoutChange} />
          <KioskAdminPanel expiresAt={expiresAt} onLock={onLock} />
        </div>
      )}

      <KioskHub />
    </div>
  );
}
