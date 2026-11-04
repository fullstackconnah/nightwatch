"use client";

/* The Sunroom Sheet's grabber (Sill DS PR 3): drag the sheet 1:1 down, rubber-banded up, dismiss on dy > 0.4h or a quick
   flick (bundle.js:450-470). Under any other theme it renders nothing. `onDismiss` is the sheet's own close path, so every
   guard that path has (the collapse animation, the pending-write check) still runs. */

import { useRef, type PointerEvent, type RefObject } from "react";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import { releaseVelocity, sheetDragY, sheetExitFrame, shouldDismiss } from "@/lib/sunroom-overlays";

/** Sunroom only: slide the sheet down over --sr-m-slide (a 180 ms fade under reduced motion), then call `done` once. From the
 *  inline offset a drag left, so a dismissing release carries on from where the finger let go. False elsewhere: the caller closes as before. */
export function slideSheetOut(panel: HTMLElement, done: () => void): boolean {
  if (!panel.closest('[data-kiosk-theme="sunroom"]')) return false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cs = getComputedStyle(panel);
  const ms = reduced ? 180 : parseFloat(cs.getPropertyValue("--sr-m-slide")) || 260;
  const easing = cs.getPropertyValue("--sr-m-ease-out").trim() || "ease-out";
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    done();
  };
  panel.style.transition = "none";
  panel.animate(sheetExitFrame(reduced), { duration: ms, easing: reduced ? "ease" : easing, fill: "forwards" }).finished.catch(() => {}).finally(fire);
  window.setTimeout(fire, ms + 80); // an unmount race can leave `finished` unresolved; the sheet must still close
  return true;
}

export function SunSheetGrabber({ panelRef, onDismiss }: { panelRef: RefObject<HTMLElement | null>; onDismiss: () => void }) {
  const sunroom = useKioskTheme() === "sunroom";
  const drag = useRef<{ id: number; y0: number; h: number; dy: number; pts: [number, number][] } | null>(null);
  if (!sunroom) return null;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (drag.current || !panel) return;
    drag.current = { id: e.pointerId, y0: e.clientY, h: panel.offsetHeight, dy: 0, pts: [[e.timeStamp, 0]] };
    e.currentTarget.setPointerCapture(e.pointerId);
    panel.style.transition = "none";
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || !panel || e.pointerId !== d.id) return;
    const raw = e.clientY - d.y0;
    d.dy = sheetDragY(raw, d.h);
    d.pts.push([e.timeStamp, raw]);
    if (d.pts.length > 5) d.pts.shift();
    panel.style.transform = `translateY(${d.dy}px)`;
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (!panel) return;
    const v = releaseVelocity(d.pts, e.timeStamp);
    if (shouldDismiss(d.dy, d.h, v)) onDismiss(); // keeps the dragged offset: the close slides on from here
    else {
      panel.style.transition = "";
      panel.style.transform = "";
    }
  };

  return (
    <div className="sr-sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden>
      <span className="sr-grabber" />
    </div>
  );
}
