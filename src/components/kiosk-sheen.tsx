"use client";

/* THESIS: the one thing globals.css's refractive edge sweep (KIOSK MOTION
   VOCABULARY, "sunroom: the refractive edge sweep") cannot do for itself —
   the CSS renders nothing until a pane carries `data-sheen`, and something
   has to put that attribute there when a finger actually lands. This file is
   that something, and nothing else: it mounts no markup, owns no visible
   pixel, and exists purely to stamp and unstamp one attribute.

   ONE delegated `pointerdown` listener on `document`, not an `onPointerDown`
   prop on every `.kiosk-sheen` pane. The hub alone can hold ~30 ToggleChip/
   SceneChip pills plus however many climate tiles are configured, all
   sunroom sheen panes; wiring a handler into each one means ~30 React
   listeners (and ~30 closures re-created on every one of those components'
   re-renders) to produce a highlight that only ever needs to know "did a
   pointer land inside *some* `.kiosk-sheen` element" — a question one
   listener at the document root can already answer via `closest()`. The
   pills and the tile root don't need to know this feature exists at all;
   they only carry the class the CSS block already keys off.

   Active only in sunroom, and only when motion is allowed: off-theme this
   would be a listener with nothing to ever match, and under reduced motion
   the CSS's own `@media (prefers-reduced-motion: reduce)` branch deletes the
   `::after` outright (see globals.css) — so stamping `data-sheen` there would
   never resolve to a visible sweep and never fire `animationend`, either.
   Rather than attach a listener that would only ever no-op or leak, this
   attaches NOTHING in either case: a delegated `document` listener costs a
   dispatch on every pointerdown anywhere on the kiosk for as long as this
   screen is on, which on a device that runs for days is a cost that needs a
   payer, and off-theme / reduced-motion there isn't one. */

import { useEffect, useRef } from "react";
import { useKioskTheme } from "@/components/kiosk-theme";
import { prefersReducedMotion, KIOSK_SHEEN_MS } from "@/lib/kiosk-motion";

/** The sweep's own CSS `animation-name` (globals.css's `@keyframes
 *  kiosk-sheen-sweep`) — the filter that keeps a bubbled `animationend` from
 *  some unrelated descendant animation from stripping the attribute early. */
const SWEEP_ANIMATION_NAME = "kiosk-sheen-sweep";

/** Per-pane bookkeeping for an in-flight sheen: the pending fallback timer
 *  and the exact listener function that was attached, so cleanup can remove
 *  precisely what was added rather than guess. */
interface InFlightSheen {
  timeoutId: ReturnType<typeof setTimeout>;
  onAnimEnd: (event: Event) => void;
}

export function KioskSheen(): null {
  const theme = useKioskTheme();

  // Keyed by the pane element itself rather than by id/index: panes are
  // pills and tile roots scattered across kiosk-hub.tsx and
  // kiosk-climate.tsx with no shared identity scheme, and the element IS the
  // only handle this file ever needs (to stamp/strip its attribute and to
  // (de)register its listener). A ref, not state — this bookkeeping never
  // drives a render, it only drives cleanup.
  const inFlightRef = useRef<Map<Element, InFlightSheen>>(new Map());

  useEffect(() => {
    // Off-theme or reduced-motion: attach no listener at all (see THESIS).
    if (theme !== "sunroom" || prefersReducedMotion()) return;

    const inFlight = inFlightRef.current;

    /** Strips `data-sheen` and cancels whichever of the two release paths
     *  did NOT fire, so the pane is left in a clean state no matter which
     *  one triggered this. Idempotent: a pane not in `inFlight` (already
     *  released, or never armed) is a no-op. */
    const release = (pane: Element) => {
      const entry = inFlight.get(pane);
      if (!entry) return;
      inFlight.delete(pane);
      clearTimeout(entry.timeoutId);
      pane.removeEventListener("animationend", entry.onAnimEnd);
      pane.removeAttribute("data-sheen");
    };

    /** Stamps `data-sheen` on `pane` and arms both release paths. Does
     *  nothing if the pane is already mid-sweep (checked by the caller via
     *  `hasAttribute`, restated here as the actual guard) — a second tap
     *  mid-sweep must not restart it, or the animation stutters instead of
     *  glinting. */
    const arm = (pane: Element) => {
      if (pane.hasAttribute("data-sheen")) return;
      pane.setAttribute("data-sheen", "");

      // Path 1: the sweep finishes normally. `animationend` bubbles, so it
      // is filtered to the sweep's own animation name — otherwise any other
      // animation finishing on a descendant of the pane (a pill's icon, a
      // tile's own state transition) would strip the attribute mid-sweep.
      //
      // Verified rather than assumed: the sweep animates the pane's `::after`
      // pseudo-element (globals.css), and pseudo-elements have no DOM node of
      // their own to be an event target. Checked in headless Chrome with a
      // minimal repro (an `::after` `animation` plus a listener on the host
      // element): the event's `target` is the HOST element itself — here,
      // `pane` — and its `pseudoElement` field reads `"::after"`. So a
      // listener attached directly to `pane` (not delegated further, unlike
      // the outer pointerdown listener) receives it exactly like any other
      // animation on the element proper; no extra routing through
      // `pseudoElement` is needed to make this fire.
      const onAnimEnd = (event: Event) => {
        const animationName = (event as AnimationEvent).animationName;
        if (animationName !== SWEEP_ANIMATION_NAME) return;
        release(pane);
      };
      pane.addEventListener("animationend", onAnimEnd, { once: true });

      // Path 2: the fallback deadline. `animationend` never fires if the
      // pane unmounts mid-sweep (a climate tile whose entity goes
      // unavailable) or if the theme leaves sunroom while `data-sheen` is
      // set, because the CSS rule that creates the animated `::after` is
      // theme-scoped and the pseudo-element simply stops existing — no event
      // is dispatched for a pseudo-element that never gets to finish because
      // it was deleted, not completed. `+ 120` is slack past the sweep's own
      // duration so a normal completion always wins path 1 first.
      const timeoutId = setTimeout(() => release(pane), KIOSK_SHEEN_MS + 120);

      inFlight.set(pane, { timeoutId, onAnimEnd });
    };

    const onPointerDown = (event: PointerEvent) => {
      const pane = (event.target as Element | null)?.closest?.(".kiosk-sheen");
      if (!pane) return;
      arm(pane);
    };

    document.addEventListener("pointerdown", onPointerDown, { passive: true });

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      // Complete cleanup, not best-effort: every pane still mid-sweep when
      // this effect tears down (unmount, or the theme changing away from
      // sunroom) gets its timer cancelled, its listener removed, and its
      // attribute stripped — otherwise a pane whose animated `::after` just
      // vanished with the theme would be left permanently marked `data-sheen`
      // and could never sheen again once the theme returns.
      for (const pane of Array.from(inFlight.keys())) release(pane);
    };
  }, [theme]);

  return null;
}
