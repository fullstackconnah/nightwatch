/* THESIS: the kiosk redesign's one merged surface (Glance ⇄ Full) moves DOM
   nodes — not copies of them — between two very different layouts (see
   docs/kiosk-analysis/redesign-06-space-and-modes.md, "Shared-element (FLIP)
   contract"). A plain CSS transition can't animate that: the element's own
   layout position changes discontinuously the instant React reflows it, so
   without help it just teleports. FLIP (First-Last-Invert-Play) fixes that
   by measuring the element's rect before and after the layout change, then
   playing the INVERSE transform (old position expressed relative to the new
   one) so it visually starts where it was and eases to where it now sits.
   Everything here is WAAPI (`Element.animate`) + plain refs — no motion
   library, per PRODUCT.md's no-new-deps rule. */

import { useCallback, useLayoutEffect, useRef } from "react";

export const KIOSK_MOVE_MS = 420; // shared-element travel between views
export const KIOSK_FADE_MS = 180; // content entering/leaving a view
export const KIOSK_POP_MS = 260; // takeover / modal entrance
export const KIOSK_EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)"; // ease-out-expo
export const KIOSK_REDUCED_MS = 120; // the reduced-motion crossfade

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface KioskFlipGroup {
  /** Returns a ref callback to attach to the shared-element node for `id`.
   *  Stable across re-renders (memoized per id) so it never churns React's
   *  ref-attach/detach cycle on its own. */
  register: (id: string) => (node: HTMLElement | null) => void;
}

/**
 * Registry keyed by a stable string id (`clock`, `temp`, `forecast`,
 * `server-line`, per the contract). `key` is the value whose change means
 * "this group's layout may have moved" — the surface's view mode
 * ("glance" | "full"). Nodes registered under the same id across a `key`
 * change are assumed to be the SAME shared element (per the redesign's own
 * invariant — glance/full reuse the literal DOM node, they don't remount
 * it), so this only ever measures a rect diff; it never handles cross-fade
 * or enter/exit, which is a different concern (KIOSK_FADE_MS, owned by
 * whichever component un/mounts non-shared content around the shared ones).
 *
 * How the "before" rect stays fresh even though there's no captureBeforeUpdate
 * hook: this effect runs after EVERY commit (no dependency array), not just
 * when `key` changes. Each run re-measures every registered node and stores
 * the rect in `rectsRef` for next time; a FLIP animation only actually PLAYS
 * when `key` changed since the last run (see `keyChanged` below) — refreshing
 * the baseline is unconditional, playing the animation is not. This matters
 * because the shared nodes can move for reasons that have nothing to do with
 * `key` (a weather reading arriving, the health poll landing, the forecast
 * rail gating on `days.length`): if the baseline were only refreshed on key
 * change, the NEXT mode flip would FLIP from a rect that's been stale since
 * mount, and the element would visibly fly in from a position it never
 * actually occupied.
 *
 * A node with an animation still in `animsRef` is excluded from that
 * unconditional refresh — but ONLY from the refresh, never from playing a
 * new FLIP. `getBoundingClientRect()` on a node mid-WAAPI-animation reports
 * its CURRENT on-screen (transformed) position, not the layout position the
 * animation is travelling toward, so storing that as a plain baseline would
 * poison the NEXT commit's rect with a transformed, not resting, value —
 * that's why a no-key-change commit skips it and leaves the stored rect
 * alone (the node's `anim.finished` handler re-measures it once the
 * animation actually completes and the node is back at its plain,
 * untransformed layout position). But if `key` DOES change while a node is
 * still travelling — a rapid glance→full→glance re-flip — the in-flight
 * transform's live position is exactly the right "from" rect for the
 * reversal, so that case measures the node BEFORE cancelling (capturing the
 * live transformed position), cancels the old animation, then measures again
 * AFTER cancelling (now back to the plain layout rect) to get the new "to".
 * Skipping an in-flight node on a key change instead of reversing it would
 * strand it easing toward a target that layout has already abandoned.
 */
export function useFlipGroup(key: string | number): KioskFlipGroup {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const rectsRef = useRef(new Map<string, DOMRect>());
  const animsRef = useRef(new Map<string, Animation>());
  const callbacksRef = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const prevKeyRef = useRef<string | number | null>(null);
  const firstRunRef = useRef(true);

  const register = useCallback((id: string) => {
    let cb = callbacksRef.current.get(id);
    if (!cb) {
      cb = (node: HTMLElement | null) => {
        if (node) nodesRef.current.set(id, node);
        else nodesRef.current.delete(id);
      };
      callbacksRef.current.set(id, cb);
    }
    return cb;
  }, []);

  // No dependency array — this must run after every commit, not just when
  // `key` changes, to keep `rectsRef` fresh (see the comment above). Whether
  // it PLAYS an animation is still gated on `keyChanged` below.
  useLayoutEffect(() => {
    const keyChanged = !firstRunRef.current && prevKeyRef.current !== key;
    const reduced = prefersReducedMotion();

    for (const [id, node] of nodesRef.current) {
      const inFlight = animsRef.current.get(id);

      if (keyChanged && !reduced) {
        // Measure BEFORE cancelling: for a node still travelling, this rect
        // includes its live WAAPI transform — i.e., where it actually is on
        // screen right now — which is the correct "from" origin for a
        // reversal. For an idle node, the rect stored on the previous run is
        // the correct origin instead (nothing else could have moved it since
        // then, per the comment above `useFlipGroup`).
        const visualRect = node.getBoundingClientRect();
        const oldRect = inFlight ? visualRect : rectsRef.current.get(id);

        // Cancel any in-flight animation now so a rapid re-flip mid-travel
        // reverses smoothly instead of jumping — the in-progress transform
        // is simply overwritten by the new one.
        inFlight?.cancel();

        // After cancelling, the transform is gone — this is the clean,
        // untransformed layout rect, and the true destination for whatever
        // FLIP plays next.
        const newRect = node.getBoundingClientRect();

        if (oldRect) {
          const dx = oldRect.left - newRect.left;
          const dy = oldRect.top - newRect.top;
          // Single uniform scale derived from width (per the contract —
          // never animate width/height directly, and never skew glyphs with
          // independent x/y scale).
          const scale = newRect.width > 0 ? oldRect.width / newRect.width : 1;

          if (dx !== 0 || dy !== 0 || scale !== 1) {
            const anim = node.animate(
              [
                { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, transformOrigin: "top left" },
                { transform: "none", transformOrigin: "top left" },
              ],
              { duration: KIOSK_MOVE_MS, easing: KIOSK_EASE_OUT },
            );
            animsRef.current.set(id, anim);
            anim.finished.catch(() => {}).finally(() => {
              if (animsRef.current.get(id) === anim) {
                animsRef.current.delete(id);
                // The node is back at its resting (untransformed) layout rect
                // now that the animation is done — safe to store as next
                // time's baseline, which the per-commit measurement couldn't
                // do while this animation was in flight.
                rectsRef.current.set(id, node.getBoundingClientRect());
              }
            });
          } else {
            // No visible movement — nothing to animate, and the cancelled
            // `inFlight` (if any) must not linger in the map: it's already
            // dead, and leaving it there would make the NEXT commit's
            // baseline-refresh skip (below) treat this node as still
            // travelling when it isn't.
            animsRef.current.delete(id);
          }
        } else {
          // No baseline to FLIP from (a node that just joined the registry
          // on the same commit `key` changed) — same cleanup as above.
          animsRef.current.delete(id);
        }

        rectsRef.current.set(id, newRect);
        continue;
      }

      // No key change this commit (or reduced motion, which never starts an
      // animation in the first place) — just keep the baseline fresh, unless
      // this node is mid-animation: see the comment above `useFlipGroup` for
      // why that rect can't be trusted yet. Its own `finished` handler above
      // re-measures it once it's safe to.
      if (inFlight) continue;

      rectsRef.current.set(id, node.getBoundingClientRect());
    }

    prevKeyRef.current = key;
    firstRunRef.current = false;
  });

  return { register };
}

/**
 * One-off FLIP for a node that is about to unmount toward a rect it will
 * never actually occupy — the "alert takeover minimises into the alert
 * button" case, where source and target are not both mounted at once (the
 * takeover is a full-screen overlay; the button underneath it is a
 * different element with its own count/tint state).
 *
 * Two ways to build that: animate a transient CLONE of the source into the
 * target's rect, or animate the SOURCE itself toward the target's rect and
 * let the caller unmount it when the animation finishes. This takes the
 * second, simpler option — the source is already being torn down
 * regardless, so there's no extra DOM to create or clean up on interrupt,
 * and nothing to keep visually in sync with the real button (which may be
 * re-rendering its own badge/tint at the same time) the way a cloned node
 * would. The cost is that the source's own content (long headline text
 * etc.) visibly shrinks with it rather than cross-fading into the button's
 * icon+badge — acceptable here because the whole point is "this alert is
 * going into that corner," not a pixel-perfect morph.
 *
 * Returns null (does nothing) under prefers-reduced-motion — callers should
 * fall back to an instant removal or their own short crossfade.
 */
export function flipOutTo(source: HTMLElement, targetRect: DOMRect, durationMs = KIOSK_MOVE_MS): Animation | null {
  if (prefersReducedMotion()) return null;

  const sourceRect = source.getBoundingClientRect();
  const dx = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
  const dy = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
  const scale =
    sourceRect.width > 0 ? Math.min(targetRect.width / sourceRect.width, targetRect.height / sourceRect.height) : 1;

  return source.animate(
    [
      { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 },
    ],
    { duration: durationMs, easing: KIOSK_EASE_OUT, fill: "forwards" },
  );
}
