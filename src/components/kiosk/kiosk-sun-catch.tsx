"use client";

/* The Sunroom sun catch and chip marks (Sill DS PR 2). Under any other theme these render nothing, so the
   other 15 themes keep their markup (shape brief rule 7). The disc itself is CSS: kiosk/sunroom/controls.css. */

import type { PointerEvent } from "react";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import { catchOrigin, chipWord } from "@/lib/sunroom-controls";

/** First child of a raised face: the layer the sun disc grows inside. */
export function SunCatch() {
  if (useKioskTheme() !== "sunroom") return null;
  return (
    <span className="sr-lit" aria-hidden>
      <span className="sr-catch" />
    </span>
  );
}

/** onPointerDown for any face holding a SunCatch: aims the disc at the touch point. */
export function aimCatch(e: PointerEvent<HTMLElement>) {
  const disc = e.currentTarget.querySelector<HTMLElement>(":scope > .sr-lit > .sr-catch, .sr-lit > .sr-catch");
  if (!disc) return;
  disc.style.transformOrigin = catchOrigin(disc.parentElement!.getBoundingClientRect(), e.clientX, e.clientY);
}

/** The pip and the state word of a Chip. */
export function SunChipMarks({ on, error, busy }: { on: boolean; error?: boolean; busy?: boolean }) {
  if (useKioskTheme() !== "sunroom") return null;
  const { word, tone } = chipWord({ on, error, busy });
  return (
    <>
      <span className="sr-pip" aria-hidden />
      <span className="sr-state" data-sr-tone={tone}>
        {word}
      </span>
    </>
  );
}

/** The Switch's track and thumb; the catch floods the track when the switch is on (aria-checked on the button). */
export function SunSwitchTrack() {
  if (useKioskTheme() !== "sunroom") return null;
  return (
    <span className="sr-switch-track" aria-hidden>
      <SunCatch />
      <span className="sr-switch-thumb" />
    </span>
  );
}
