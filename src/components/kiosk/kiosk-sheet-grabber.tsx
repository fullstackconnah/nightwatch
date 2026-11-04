"use client";

/* The Sunroom Sheet's grabber (Sill DS PR 3): drag the sheet 1:1 down, rubber-banded up, dismiss on dy > 0.4h or a quick
   flick (bundle.js:450-470). Under any other theme it renders nothing. `onDismiss` is the sheet's own close path, so every
   guard that path has (the collapse animation, the pending-write check) still runs. */

import { useRef, type PointerEvent, type RefObject } from "react";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import { releaseVelocity, sheetDragY, shouldDismiss } from "@/lib/sunroom-overlays";

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
    panel.style.transition = "";
    panel.style.transform = "";
    if (shouldDismiss(d.dy, d.h, v)) onDismiss();
  };

  return (
    <div className="sr-sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden>
      <span className="sr-grabber" />
    </div>
  );
}
