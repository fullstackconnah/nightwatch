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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Minimize2, ShieldAlert } from "lucide-react";
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
import { KioskCarousel } from "@/components/kiosk-carousel";
import { useKioskWidgetLayout } from "@/lib/kiosk-widgets";
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
import { KioskDoorbellButton } from "@/components/kiosk-doorbell";
import { KioskStatusStripExtras } from "@/components/kiosk-status-strip";
import { StaleTag } from "@/components/kiosk-stale-tag";
import { KioskRadarModal, useKioskRadar } from "@/components/kiosk-radar";

type KioskViewMode = "glance" | "full";

// 30s of no interaction returns to glance — the contract's number, not a
// tuned guess.
/* The glance band's reserved height. 132px suits the five-day rail at the
   glance type ramp (icon + high + low/rain stack), so the pane people see
   most sits at the size it always did.

   It shrinks on a SHORT viewport because glance is a fixed-height screen with
   scrolling locked: measured at 800x480, a 132px band pushed the floodlight
   control to y=477 against a 480px viewport — below the fold, and with no
   scrolling, unreachable. Trading band height for a reachable control is the
   right way round.

   One height per viewport, never per pane: this subtree feeds the header's
   FLIP measurement, so a band that resized as it rotated would nudge the
   clock on every advance. */
const GLANCE_BAND_HEIGHT_CLASS = "h-[132px] [@media(max-height:700px)]:h-[88px]";

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

  /** Drop straight back to glance without waiting out the idle timer.
   *
   *  The timer is cleared as well as the mode being set — leaving it armed
   *  would fire a redundant `setViewMode("glance")` up to KIOSK_IDLE_MS later,
   *  which is harmless today but is exactly the kind of stray timer that turns
   *  into a bug the moment glance stops being the idle destination.
   *
   *  Does nothing while pinned: `mode` below is hard-wired to "full" in that
   *  case (elevated sessions need the hub), so silently accepting the call and
   *  changing nothing would leave a button that looks live and isn't. The
   *  caller doesn't render it while pinned. */
  const returnToGlance = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setViewMode("glance");
  }, []);

  return { mode: pinned ? "full" : viewMode, onInteraction, returnToGlance } as const;
}

/** Timing for the non-shared content's fade (contract: fades out BEFORE the
 *  shared elements land, fades in AFTER; total ≤600ms). `mode` flips
 *  immediately and drives the header's shape, the FLIP key, AND which
 *  content is IN FLOW here — there is no lagging "displayMode" any more.
 *  That's the fix for the reported jitter: the outgoing FLIP diagnosis found
 *  that holding the outgoing block in normal flow for KIOSK_FADE_MS after
 *  `mode` changed kept the page a different height than its final shape for
 *  that whole window, so `useFlipGroup`'s same-frame measurement targeted a
 *  layout that was about to move again the instant the outgoing block
 *  unmounted — a second, uncovered jump partway through the shared-element
 *  travel. Fixed by making the INCOMING content's layout final on frame 1:
 *  it mounts in flow immediately (invisible), and the OUTGOING content is
 *  pulled out of flow (`position: absolute`, see the `overlay` prop on
 *  `RevealBlock` below) so its fade-out can no longer affect anyone else's
 *  layout.
 *
 *  Sequence from t=0 (mode changes):
 *   - [0, FADE_MS]        outgoing content (still mounted, now absolute)
 *                         fades from opacity-100 to 0, overlaid on top of
 *                         the incoming content, which is already in flow
 *                         but sitting at opacity-0 underneath it. The shared
 *                         elements begin their MOVE_MS travel toward their
 *                         final (already-correct) rects underneath both.
 *   - FADE_MS             outgoing content unmounts.
 *   - [FADE_MS, MOVE_MS]  incoming content stays invisible — the shared
 *                         elements are still travelling.
 *   - MOVE_MS             shared elements have landed; incoming content
 *                         starts its own FADE_MS fade-in.
 *   - MOVE_MS + FADE_MS   done. (420 + 180 = 600ms, the contract's cap.)
 *
 *  Reduced motion skips all of the above and swaps instantly (no outgoing
 *  overlay is ever created; `register()` itself already no-ops the
 *  shared-element travel under reduced motion, so there's nothing to wait
 *  for on that side either).
 *
 *  The transition's start (which content becomes `outgoingMode`, and that
 *  `incomingVisible` resets to false) is derived SYNCHRONOUSLY during render
 *  by comparing `mode` to a ref of the last mode seen — the standard React
 *  "adjust state when a prop changes" pattern — rather than in an effect.
 *  An effect would only run after this render commits, one extra render
 *  behind `mode` itself, and the FIRST commit with the new `mode` would
 *  therefore still show the OLD transition state for one frame (the
 *  outgoing block still in flow, the incoming block not yet mounted) —
 *  reintroducing exactly the kind of same-frame layout mismatch this fix
 *  exists to remove. Deriving it in-render means the very first commit that
 *  has the new `mode` already has the new transition state too.
 *
 *  Only the two timers (unmount the outgoing block after FADE_MS; reveal
 *  the incoming block after MOVE_MS) are genuinely time-based, so those stay
 *  in a `useEffect` keyed on `transitionToken` — bumped only when a real
 *  (non-reduced) transition starts. Its cleanup (React's normal effect
 *  cleanup, run automatically when the token changes again) is what gives
 *  the rapid-reflip safety: a glance→full→glance re-flip mid-transition
 *  cancels the previous transition's pending timers and starts a fresh pair
 *  for the new one, so nothing is ever stranded fading toward a target
 *  that's no longer wanted. */
function useModeContent(mode: KioskViewMode) {
  // Computed once (first render) rather than on every render; `null` just
  // means "not measured yet" so it's never recomputed after that first read.
  const reducedRef = useRef<boolean | null>(null);
  if (reducedRef.current === null) reducedRef.current = prefersReducedMotion();
  const prevModeRef = useRef(mode);
  const [state, setState] = useState<{ outgoingMode: KioskViewMode | null; incomingVisible: boolean }>({
    outgoingMode: null,
    incomingVisible: true,
  });
  const [transitionToken, setTransitionToken] = useState(0);
  const firstEffectRunRef = useRef(true);

  if (mode !== prevModeRef.current) {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;
    if (reducedRef.current) {
      setState({ outgoingMode: null, incomingVisible: true });
    } else {
      setState({ outgoingMode: prevMode, incomingVisible: false });
      setTransitionToken((t) => t + 1);
    }
  }

  useEffect(() => {
    if (firstEffectRunRef.current) {
      firstEffectRunRef.current = false;
      return;
    }
    if (reducedRef.current) return;

    const outTimer = setTimeout(() => {
      setState((s) => (s.outgoingMode !== null ? { ...s, outgoingMode: null } : s));
    }, KIOSK_FADE_MS);
    const inTimer = setTimeout(() => {
      setState((s) => (s.incomingVisible ? s : { ...s, incomingVisible: true }));
    }, KIOSK_MOVE_MS);

    return () => {
      clearTimeout(outTimer);
      clearTimeout(inTimer);
    };
  }, [transitionToken]);

  return {
    outgoingMode: state.outgoingMode,
    incomingVisible: state.incomingVisible,
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
          // Height cap, same reasoning (and same `!`) as the clock's — this
          // ramp is keyed on width and a landscape wall panel is wide and
          // short, so `md:` was handing it the largest face in the one case
          // with the least room for it.
          !full && "[@media(max-height:700px)]:!text-5xl",
        )}
      >
        {Math.round(current.tempC)}°
      </span>
      <span
        className={cn(
          "truncate text-ink-dim",
          full ? "text-sm" : "max-w-full text-xl min-[420px]:text-2xl md:text-3xl",
          !full && "[@media(max-height:700px)]:!text-2xl",
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
/** Pins the document while the surface is in glance.
 *
 *  Sizing the glance column to the viewport stops it GENERATING overflow, but
 *  it doesn't stop the document scrolling — the night overlay, the alert
 *  takeover and the browser's own overscroll can all still move it, and a wall
 *  panel nudged 40px off-centre by a stray swipe stays that way until somebody
 *  notices. So glance also locks the scroll port outright.
 *
 *  Applied to documentElement/body rather than to KioskThemeScope's div for a
 *  specific reason: that div is deliberately `overflow-x-clip` and NOT
 *  `overflow-hidden`, because `hidden` on one axis force-promotes the other
 *  from `visible` to `auto` (CSS Overflow 3's visible-forcing rule), which
 *  turns it into a scroll container and breaks `position: sticky` on the
 *  full-mode header — that exact regression is already documented in
 *  kiosk-theme.tsx. Locking the document instead leaves that div untouched.
 *
 *  Full mode is left alone entirely: its content legitimately exceeds the
 *  viewport (several climate rooms plus a switch bank) and it has a
 *  scroll-shadow affordance for precisely that case.
 *
 *  The previous inline values are restored on the way out rather than blindly
 *  cleared, so this composes with anything else that may have set them. */
function useGlanceScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof document === "undefined") return;
    const de = document.documentElement;
    const { body } = document;
    const prevDe = de.style.overflow;
    const prevBody = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    de.style.overflow = "hidden";
    body.style.overflow = "hidden";
    // Kills the rubber-band on touch, which on iOS scrolls the page even when
    // overflow is hidden.
    body.style.overscrollBehavior = "none";
    // Returning from a scrolled full view would otherwise strand glance at
    // that offset, with no way to scroll back now that scrolling is off.
    window.scrollTo(0, 0);
    return () => {
      de.style.overflow = prevDe;
      body.style.overflow = prevBody;
      body.style.overscrollBehavior = prevOverscroll;
    };
  }, [locked]);
}

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
  onDoorbellClick,
}: {
  period: KioskPeriod;
  layout: KioskLayoutChoice;
  onLayoutChange: (next: KioskLayoutChoice) => void;
  elevated: boolean;
  expiresAt: number | null;
  onAdminClick: () => void;
  onLock: () => void;
  /** Opens the front-door camera on demand. The modal itself is owned by
   *  page.tsx (it has to outlive this surface — see the watcher's comment
   *  there); this component contributes only the button that asks for it. */
  onDoorbellClick: () => void;
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
  const { mode, onInteraction, returnToGlance: onReturnToGlance } = useKioskMode(
    pinned,
    suspended,
    initialMode ?? "glance",
  );

  const flip = useFlipGroup(mode);
  const { outgoingMode, incomingVisible, durationMs } = useModeContent(mode);
  const weather = useWeatherView();
  // `full` drives the header's shape, the FLIP timing, AND which non-shared
  // content is in flow — all three flip on the same frame `mode` does now
  // (see useModeContent's comment for why the old lagged "contentFull" was
  // the other half of the reported jitter). `outgoingMode`/`incomingVisible`
  // below handle only the fade, not what's in flow.
  const full = mode === "full";
  const fullIsOutgoing = outgoingMode === "full";
  const glanceIsOutgoing = outgoingMode === "glance";
  const fullMounted = full || fullIsOutgoing;
  const glanceMounted = !full || glanceIsOutgoing;

  const days: WeatherDay[] = weather.ok?.days ?? [];
  // The band's panes come from the same reorderable list the Widgets tab
  // edits, so "what rotates through the forecast slot" is a user choice.
  const widgetLayout = useKioskWidgetLayout();
  const glanceBandIds = widgetLayout.glance;
  /* The radar modal is owned HERE, not by the rail that opens it. In glance the
     rail lives inside a carousel pane, so a rail-owned modal is unmounted by
     the next auto-advance — the radar would disappear a few seconds after you
     opened it, and again on any glance→full flip. Mounted at this level it
     outlives both, exactly like the doorbell modal is owned a level higher
     again (page.tsx) for the same class of reason. */
  const radar = useKioskRadar();
  const bandCtx = useMemo(
    () => ({ period, onDoorbellClick, onRadarClick: radar.open }),
    [period, onDoorbellClick, radar.open],
  );
  const showBottomShadow = useBottomScrollShadow(full);
  useGlanceScrollLock(!full);

  return (
    <div
      onPointerDown={onInteraction}
      className={cn(
        "flex flex-col",
        full
          ? "gap-3"
          : /* Glance is ONE SCREEN. `h-` and not `min-h-`: with a minimum the
               column simply grew past the viewport and the page scrolled —
               measured on production at 49px of overflow at 1024x768, 17px at
               1280x800 and 337px at 800x480, all of them really scrollable.
               A wall display that can be nudged off-centre by a stray swipe,
               and then sits that way until someone notices, is a bug; there is
               nothing below the fold worth reaching for.
               `overflow-hidden` is the backstop for the short-viewport case
               the gaps alone can't rescue. The two corner buttons are `fixed`,
               so they sit outside this box and stay reachable even when the
               stack inside it is clipped. */
            /* gap-3 on a short viewport, for the same reason the band and the
               clock step down there: this gap sits between the header and
               glance's own stack, and at 800×480 every 12px of rhythm is 12px
               the column either fits in or clips. */
            "h-[calc(100dvh-2rem)] items-center justify-center gap-6 overflow-hidden px-6 text-center [@media(max-height:700px)]:gap-3",
      )}
    >
      {/* Fixed overlay, outside the flow — mounted here per the contract's
          ownership map (agent D mounts it), built by agent A. */}
      <KioskAlerts onOverlayStateChange={setAlertOverlayOpen} />

      {/* The rain radar, opened from the forecast rail's Today cell in either
          mode (see `radar` above for why it is mounted out here rather than
          inside the rail). It self-marks aria-modal, so useDomModalOpen already
          suspends the idle return while it's up. */}
      {radar.isOpen && (
        /* `contents` generates no box, so this wrapper adds neither a flex item
           nor one of the column's gaps — it exists only to be a DOM ancestor
           that can stop a press from reaching this root's own promoter. Events
           bubble through the DOM tree, not the layout tree, so the stop still
           works. Without it, every tap inside the radar (scrubbing frames,
           pressing close) also flips the surface to full underneath it, and you
           would come out of a glance-mode radar into the full panel. */
        <div className="contents" onPointerDown={(e) => e.stopPropagation()}>
          <KioskRadarModal onClose={radar.close} />
        </div>
      )}

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
            ? "panel kiosk-hdr-grid sticky top-0 z-(--z-sticky) px-4 py-2.5 md:py-3"
            : // Four gaps between five stacked pieces (clock, temp, band,
              // server line): 20px each is right when there is 768px of height
              // to spend and 40px of pure overflow when there is 448px, which
              // is what a 800×480 panel has. Same max-height:700px breakpoint
              // as the band's own height class, so the whole column steps down
              // together rather than one piece at a time.
              "flex flex-col items-center gap-5 [@media(max-height:700px)]:gap-2.5",
        )}
      >
        <KioskClock ref={flip.register("clock")} size={full ? "full" : "glance"} />
        <TempNode mode={mode} weather={weather} registerRef={flip.register("temp")} />
        {/* Full mode puts the rail at the RIGHT end of the clock row
            (`ml-auto`) rather than on a line of its own: the clock and the
            current reading are small here, so a left-aligned rail left the
            band visibly lopsided with dead space between it and the edge.
            Pushed right, the row reads as one composed band — time and
            conditions now, the week ahead opposite. Glance's header is a
            flex-col where ml-auto is a no-op, so the rail stays centred
            under the clock. */}
        {/* `order`, not source order. The clock / temp / forecast / server-
            line are shared FLIP nodes identified by their position in the
            tree: moving them in JSX to get the visual arrangement would
            change that position between modes and can remount them, which is
            the one thing that kills a FLIP. CSS order rearranges the row
            without touching the DOM sequence at all — so the visual layout is
            clock · condition · running-count ····· forecast · controls, while
            the tree stays exactly as the animation needs it.

            `ml-auto` then pushes the forecast and everything ordered after it
            to the right end, so the band reads as one line: what it is now on
            the left, the week ahead on the right. */}
        {/* THE GLANCE BAND. This registered node is a shared FLIP element, so
            it must stay the same DOM node across a mode change — but its
            CONTENT is free to differ, because FLIP only measures the node's
            rect and animates a transform over it.

            In full it is the plain five-day rail, exactly as before. In glance
            it is a carousel whose first pane IS that rail, rotating through
            news, climate and containers — the wide band is the largest piece
            of real estate on the glance surface and showing only the week's
            weather there wastes it.

            GLANCE_BAND_HEIGHT_PX is fixed rather than intrinsic on purpose:
            this subtree feeds the header's own FLIP measurement, so a band
            that grew or shrank as it rotated would nudge the clock on every
            advance — the exact class of layout-moves-mid-animation bug the
            jitter fix removed. Every pane gets the same reserved height and
            centres inside it. */}
        <div ref={flip.register("forecast")} className={cn(full && "order-1 ml-auto")}>
          {full
            ? days.length > 0 && (
                <KioskForecastRail
                  days={days}
                  emphasizeIndex={period === "evening" ? 1 : null}
                  size="full"
                  // Same surface-owned modal the glance band opens (bandCtx
                  // above), so the two modes share one radar rather than each
                  // mounting its own.
                  onTodayClick={radar.open}
                />
              )
            : glanceBandIds.length > 0 && (
                <KioskCarousel
                  widgetIds={glanceBandIds}
                  ctx={bandCtx}
                  onInteraction={onInteraction}
                  heightClassName={GLANCE_BAND_HEIGHT_CLASS}
                  dotsClassName="justify-center pt-1"
                />
              )}
        </div>
        <ServerLine mode={mode} registerRef={flip.register("server-line")} />

        {full && (
          /* `basis-full` gives the controls their own line under the clock
             rather than competing for the end of the clock row. That row was
             the constraint the whole time: at 1024x768 it already carries the
             clock, the conditions, the running count and a five-day rail, and
             anything else added to it wrapped the column awkwardly (measured:
             a 142px header against 90px without). On its own line the group is
             left-aligned under the time, sits clear of the fixed alert badge
             in the opposite corner by construction, and the bar is the same
             height at both tablet sizes instead of 52px taller on the smaller
             one. `order-3` keeps it last visually without moving it in the
             DOM — the same rule the shared FLIP nodes above rely on.

             Gated on `full` (immediate), not a lagged mode — this row's own
             height is part of what the header's shared FLIP nodes measure,
             so it has to reach its final presence/absence on the same frame
             `mode` changes too, same reasoning as the content swap below.
             The tradeoff: on a full→glance exit this row now disappears
             instantly instead of fading out with the rest of full's content —
             a small, one-line cost for removing a second source of the
             reported jitter. */
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-x-3 gap-y-2">
            {/* Hidden while pinned — an elevated session is held in full mode
                on purpose, so the control would be inert. */}
            {!pinned && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  // The surface root treats any pointer press as "someone is
                  // using this" and flips to full. Without stopping the event
                  // here, pressing this button would return to glance and be
                  // thrown straight back to full by its own click.
                  e.stopPropagation();
                  onReturnToGlance();
                }}
                aria-label="Back to glance view"
                /* KioskAlertButton is `fixed` in the top-right corner at
                   z-toast, so it sits ON TOP of this area rather than in flow
                   with it, and it swallows presses from anything underneath.
                   Measured on production with a real alert standing: the badge
                   occupies x923-1004/y16-72 at 1024px. Staying in this row —
                   the one the timer and Admin already share — keeps this
                   button below that band without reserving any width. */
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs text-ink-dim outline-none transition hover:bg-panel-2 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
              >
                <Minimize2 size={14} aria-hidden />
                <span>Glance</span>
              </button>
            )}
            {/* Ahead of Admin in the row: it's the control most likely to be
                wanted in a hurry, and unlike Admin it hides itself entirely
                when Home Assistant has no door camera to show. */}
            <KioskDoorbellButton onClick={onDoorbellClick} />
            <KioskStatusStripExtras
              elevated={elevated}
              onAdminClick={onAdminClick}
              revealed={incomingVisible}
              durationMs={durationMs}
            />
          </div>
        )}
      </header>

      {/* Below-header content. Each block is keyed to a fixed MODE identity
          (glance / full), never swapped by role (incoming / outgoing) — so
          when a transition starts, the block that was in flow a moment ago
          simply gets new props (revealed→false, overlay→true) rather than
          unmounting and a fresh one mounting in its place. That's what lets
          the outgoing fade actually animate: a freshly-mounted node has no
          prior opacity to transition FROM, so it would just appear already
          invisible instead of visibly fading. The wrapper is `relative` so
          the outgoing block's `absolute` positioning anchors to it, not to
          the page (see useModeContent's comment for the full sequence). */}
      <div className="relative">
        {fullMounted && (
          <RevealBlock
            revealed={fullIsOutgoing ? false : incomingVisible}
            durationMs={durationMs}
            stack={false}
            overlay={fullIsOutgoing}
          >
            <FullContent
              period={period}
              elevated={elevated}
              expiresAt={expiresAt}
              layout={layout}
              onLayoutChange={onLayoutChange}
              onLock={onLock}
            />
          </RevealBlock>
        )}
        {glanceMounted && (
          <RevealBlock
            revealed={glanceIsOutgoing ? false : incomingVisible}
            durationMs={durationMs}
            stack={true}
            overlay={glanceIsOutgoing}
          >
            {/* No onInteraction here any more: the carousel moved up into the
                band, so it takes that prop directly above and this block is
                back to plain content. onDoorbellClick only reaches the
                optional "doorbell" widget. */}
            <KioskGlance
              period={period}
              onAdminClick={onAdminClick}
              onDoorbellClick={onDoorbellClick}
            />
          </RevealBlock>
        )}
      </div>
    </div>
  );
}

/** Wraps a mode's non-shared content in the fade the contract asks for.
 *  Deliberately a real box, not `display: contents` — `contents` generates
 *  no box of its own, and `opacity` has no visual effect on an element
 *  without one, which would silently no-op this whole fade. `stack` (glance
 *  only) recreates the gap-10 rhythm the surface's own flex column would
 *  have given these children directly, since they're now one nesting level
 *  deeper inside this wrapper; full's content is already one cohesive block
 *  (FullContent's own root div), so it needs no extra layout here.
 *
 *  `overlay` marks the OUTGOING side of a transition: taken out of flow
 *  (`absolute inset-x-0 top-0`) so its fade-out can no longer hold layout
 *  space open for anything else — the fix for half of the reported jitter,
 *  see useModeContent's comment — and `pointer-events-none` + `aria-hidden`
 *  so it's inert while it fades: a tap or a screen reader should only ever
 *  reach the real, in-flow content underneath it. */
function RevealBlock({
  revealed,
  durationMs,
  stack,
  overlay,
  children,
}: {
  revealed: boolean;
  durationMs: number;
  stack?: boolean;
  overlay?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={overlay || undefined}
      className={cn(
        "transition-opacity ease-out motion-reduce:transition-none",
        /* gap-6, down from gap-10. Glance is now a fixed-height box (see the
           surface root), so every 16px of rhythm here is 16px the content
           either fits in or loses — and the four gaps this stack and the root
           contribute were most of the 49px that used to push 1024x768 into
           scrolling. `min-h-0` lets it actually shrink inside that box rather
           than forcing its parent taller, which is what a flex child does by
           default. */
        stack && "flex min-h-0 flex-col items-center gap-6 overflow-hidden",
        overlay && "pointer-events-none absolute inset-x-0 top-0",
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
