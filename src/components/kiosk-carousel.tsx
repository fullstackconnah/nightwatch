"use client";

/* THESIS: the glance-only carousel that renders `layout.glance` (see
   kiosk-widgets.tsx) as one pane per widget — auto-advancing, swipeable, and
   built on plain pointer events + WAAPI-free CSS transitions (PRODUCT.md's
   no-new-deps rule; same "no library" posture kiosk-motion.ts's FLIP takes).

   TAP VS SWIPE VS THE ROOT PROMOTER: kiosk-surface.tsx's root div promotes
   glance -> full on ANY `pointerdown` that reaches it, synchronously, before
   the browser has even fired a `pointermove` — so there is no way to learn
   "this press is turning into a drag" before that promotion has already
   fired and unmounts this whole carousel (glance's content starts fading the
   instant `mode` flips, per useModeContent's comment in that file). Waiting
   until a drag is confirmed and calling stopPropagation() only then is a
   contradiction: the pointerdown event that would need stopping has already
   finished bubbling by the time a later pointermove tells you it was a
   swipe. So this component takes the same opt-out EVERY other glance control
   already takes (GlanceTiles' tiles, the timers/admin buttons) and stops the
   pointerdown from reaching the root unconditionally — then, since that
   swallows the "tap on dead space promotes" case too, it replays that
   promotion itself via `onInteraction` the instant a press resolves as a
   genuine tap (pointerup with no real drag). Net effect: a swipe never
   promotes (the drag consumes the gesture), a tap on a pane with no control
   under it still promotes (this component calls onInteraction on its own),
   and a tap on a real control inside a pane never reaches either path (the
   control's own onPointerDown already stopped it first — same idiom as
   before, untouched).

   EMPTINESS: every widget in `widgetIds` stays mounted at all times (so its
   own hook keeps polling and can report a fresh answer), but a widget that
   currently has nothing to show is pulled out of flow (`absolute`, 0 opacity,
   inert) rather than left as a blank swipeable page — see reportEmpty below
   and kiosk-widgets.tsx's KioskWidgetCtx comment. */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { KIOSK_MOVE_MS, KIOSK_EASE_OUT, prefersReducedMotion } from "@/lib/kiosk-motion";
import { KIOSK_WIDGET_MAP, type KioskWidgetCtx, type KioskWidgetId } from "@/lib/kiosk-widgets";

const AUTO_ADVANCE_MS = 12_000;
// "Pause while interacting, and for ~30s after any tap" (the contract this
// carousel was asked to meet) — one shared window for touch-and-release,
// drag-and-release, and a dot tap alike.
const INTERACTION_PAUSE_MS = 30_000;
// Below this many px of horizontal travel a press is still a tap candidate;
// past it (and only past it) the gesture commits to being a drag, which is
// also the point stopPropagation would matter if it could still help (see
// THESIS) — kept here anyway because it's also the signal that decides
// whether pointerup should replay the promotion or treat the release as a
// completed swipe.
const DRAG_START_PX = 10;
// How far a drag has to travel before release commits to changing the pane,
// rather than springing back to where it started.
const SWIPE_COMMIT_PX = 60;
// A reserved height, not a min — see the "pane height must be stable"
// requirement: a lights pane with a dozen entities must not grow the glance
// column taller than a one-line weather sentence does, because this feeds
// the header FLIP's own measurement (kiosk-surface.tsx / kiosk-motion.ts).
// Any pane taller than this scrolls internally instead.
const PANE_HEIGHT_PX = 176;

export function KioskCarousel({
  widgetIds,
  ctx,
  onInteraction,
  heightPx = PANE_HEIGHT_PX,
  dotsClassName,
}: {
  widgetIds: readonly KioskWidgetId[];
  ctx: Omit<KioskWidgetCtx, "reportEmpty">;
  /** The same promotion kiosk-surface.tsx's root pointerdown handler would
   *  have fired, replayed manually for a confirmed tap — see THESIS. */
  onInteraction: () => void;
  /** Reserved pane height. The default suits a free-standing column; the
   *  glance BAND (which lives inside the shared forecast FLIP node in
   *  kiosk-surface.tsx) passes a shorter one so the header keeps the height
   *  the forecast rail alone used to give it. Whatever value is passed, it
   *  must not change between panes — the header's shared-element FLIP
   *  measures this subtree, and a band that grew for one pane would move the
   *  clock every time it rotated. */
  heightPx?: number;
  /** Lets the band tuck its dots in tighter than a full-height column wants. */
  dotsClassName?: string;
}) {
  const [emptyMap, setEmptyMap] = useState<Partial<Record<KioskWidgetId, boolean>>>({});
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDx, setDragDx] = useState(0);

  const reducedRef = useRef<boolean | null>(null);
  if (reducedRef.current === null) reducedRef.current = prefersReducedMotion();
  const reduced = reducedRef.current;

  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One stable callback per widget id, created lazily and cached for the
  // component's lifetime — same "register once, reuse forever" idiom
  // useFlipGroup's `register()` uses in kiosk-motion.ts, for the same
  // reason: a fresh closure every render would make useEmptyReport's effect
  // (kiosk-widgets.tsx) re-fire every render instead of only on real change.
  const reportEmptyFns = useRef(new Map<KioskWidgetId, (empty: boolean) => void>());

  function getReportEmpty(id: KioskWidgetId) {
    let fn = reportEmptyFns.current.get(id);
    if (!fn) {
      fn = (empty: boolean) => {
        setEmptyMap((m) => (m[id] === empty ? m : { ...m, [id]: empty }));
      };
      reportEmptyFns.current.set(id, fn);
    }
    return fn;
  }

  const visible = useMemo(() => widgetIds.filter((id) => emptyMap[id] !== true), [widgetIds, emptyMap]);
  const clampedIndex = visible.length === 0 ? 0 : Math.min(index, visible.length - 1);

  function clearPauseTimer() {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
  }

  function markInteracting() {
    clearPauseTimer();
    setPaused(true);
  }

  function scheduleResume() {
    clearPauseTimer();
    pauseTimerRef.current = setTimeout(() => setPaused(false), INTERACTION_PAUSE_MS);
  }

  useEffect(() => clearPauseTimer, []);

  function goTo(next: number) {
    const n = visible.length;
    if (n === 0) return;
    setIndex(((next % n) + n) % n);
  }

  // Auto-advance. Off entirely for 0/1 visible panes (contract: a single pane
  // gets no rotation, no dots, no gesture).
  useEffect(() => {
    if (visible.length <= 1 || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % visible.length), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [visible.length, paused]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (visible.length <= 1) return;
    // See THESIS: this has to happen unconditionally, before the gesture is
    // known to be a tap or a drag, or the root's own pointerdown promoter
    // would already have fired by the time we could tell the difference.
    e.stopPropagation();
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setIsDragging(false);
    setDragDx(0);
    markInteracting();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some pointer types (rare) refuse capture — the gesture still works
      // via ordinary bubbling within this element, just without capture's
      // "keep tracking outside my bounds" guarantee.
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = pointerRef.current;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!isDragging) {
      // Horizontal-locked: a mostly-vertical press (someone scrolling past
      // the panel, if it ever scrolls) never gets claimed as a swipe.
      if (Math.abs(dx) < DRAG_START_PX || Math.abs(dx) < Math.abs(dy)) return;
      setIsDragging(true);
    }
    // "No sliding" under reduced motion (the contract's own words) means no
    // live visual follow either, not just no eased settle — dragDx is still
    // tracked (release still needs to know which way and how far) but never
    // rendered into the transform; see the track's style below.
    setDragDx(dx);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (!start || start.id !== e.pointerId) return;

    if (isDragging) {
      if (dragDx <= -SWIPE_COMMIT_PX) goTo(clampedIndex + 1);
      else if (dragDx >= SWIPE_COMMIT_PX) goTo(clampedIndex - 1);
      // else: under the commit threshold — springs back to clampedIndex,
      // nothing to do, the transform below already resolves to it once
      // dragDx resets.
    } else {
      // A genuine tap, and it reached us — meaning it did NOT land on a
      // control that already stopped it (those opt out before we ever see
      // the press, same as every other glance control). Replay the
      // promotion this element's own pointerdown swallowed.
      onInteraction();
    }
    setIsDragging(false);
    setDragDx(0);
    scheduleResume();
  }

  function onPointerCancel() {
    pointerRef.current = null;
    setIsDragging(false);
    setDragDx(0);
  }

  if (widgetIds.length === 0) return null;

  const liveDrag = isDragging && !reduced;
  const trackTransition = liveDrag ? "none" : reduced ? "none" : `transform ${KIOSK_MOVE_MS}ms ${KIOSK_EASE_OUT}`;

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-3">
      {/* Height is reserved unconditionally when there's at least one visible
          pane (never mid-transition, never animated — "never animate
          width/height" per the motion contract) so an all-empty moment (every
          configured widget quiet at once) collapses to nothing rather than
          holding a blank box open. */}
      <div
        className={cn("relative w-full overflow-hidden", visible.length > 0 ? "" : "h-0")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        // Lets the browser still own vertical scrolling/scroll-bounce; only
        // horizontal drag is this component's to claim.
        style={{ ...(visible.length > 0 ? { height: heightPx } : {}), touchAction: "pan-y" }}
      >
        <div
          className="flex h-full w-full"
          style={{
            transform: `translateX(calc(${-clampedIndex * 100}% + ${liveDrag ? dragDx : 0}px))`,
            transition: trackTransition,
          }}
        >
          {widgetIds.map((id) => {
            const def = KIOSK_WIDGET_MAP.get(id);
            if (!def) return null;
            const isEmpty = emptyMap[id] === true;
            const visibleIdx = visible.indexOf(id);
            const isCurrent = !isEmpty && visibleIdx === clampedIndex;
            return (
              <div
                key={id}
                aria-hidden={!isCurrent}
                className={cn(
                  "flex h-full w-full shrink-0 items-center justify-center overflow-y-auto px-2 transition-opacity motion-reduce:transition-none",
                  isEmpty ? "pointer-events-none absolute inset-0 opacity-0" : "",
                )}
                style={{
                  // Parked well outside the viewport rather than merely
                  // opacity-0 in place: a widget that's currently empty must
                  // not occupy a flex slot the visible-index math above
                  // assumes only non-empty panes fill.
                  transform: isEmpty ? "translateX(200%)" : undefined,
                  opacity: isEmpty ? 0 : isCurrent ? 1 : 0,
                  transitionDuration: `${reduced ? 0 : KIOSK_MOVE_MS}ms`,
                  pointerEvents: isCurrent ? "auto" : "none",
                }}
              >
                {def.render({ ...ctx, reportEmpty: getReportEmpty(id) })}
              </div>
            );
          })}
        </div>
      </div>

      {visible.length > 1 && (
        <div className={cn("flex items-center gap-1", dotsClassName)}>
          {visible.map((id, i) => (
            <button
              key={id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                markInteracting();
                goTo(i);
                scheduleResume();
              }}
              aria-label={`Show ${KIOSK_WIDGET_MAP.get(id)?.label ?? "pane"}`}
              aria-current={i === clampedIndex}
              // 44px real target holding a visually smaller 6px dot — same
              // invisible-hit-area/inner-chip split kiosk-climate.tsx's
              // EXPAND_BUTTON/EXPAND_BUTTON_CHIP pair uses.
              className="flex h-11 w-11 items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  i === clampedIndex ? "bg-accent" : "bg-line-bright",
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
