"use client";

/* THESIS: a target temperature that changes should turn like a dial behind
   glass, not cut — see globals.css's "the digit reel" block (KIOSK MOTION
   VOCABULARY) for the transition timing this rides on. Only the TARGET ever
   gets this treatment (kiosk-climate.tsx wires it that way): the target is
   the number you turn, and the current temperature is the room answering —
   rolling the room's answer would claim the wall panel had changed it.

   Each digit character becomes an independent reel column holding the digits
   0-9 stacked TWICE (20 cells), which is what makes this an odometer rather
   than a slider: with a single 0-9 strip, incrementing 9->0 would roll
   BACKWARDS through 8,7,...,0 — the exact tell that makes a fake odometer
   effect look cheap. With two copies, 9->0 can instead continue forward into
   the second copy's "10" cell (which also reads "0"), and the direction
   search below picks whichever copy actually continues the requested
   direction. Punctuation (`.`, `°`, unit letters, `-`, space) is rendered as
   a plain static span beside the columns — a rolling decimal point is a
   glitch, not a mechanism. */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** The two-copy strip: [0,1,...,9,0,1,...,9]. Cell `i` shows digit `i % 10`;
 *  for any digit there are exactly two cells that show it, at `digit` and
 *  `digit + 10`. */
const REEL_CELLS: readonly number[] = [...Array(10).keys(), ...Array(10).keys()];

/** Picks the landing cell (0..19) for `digit` given the direction the value
 *  is actually moving. There are only ever two candidates — `digit` (the
 *  first copy) and `digit + 10` (the second) — which is the whole point of
 *  carrying the strip twice: the direction search only ever has to choose
 *  between them, never walk the full 20-cell range.
 *
 *  direction === 1 (value went up): the smallest candidate strictly ahead of
 *  `current` — i.e. keep rolling forward.
 *  direction === -1 (value went down): the largest candidate strictly behind
 *  `current` — i.e. keep rolling backward.
 *  direction === 0, or a directional search that finds no candidate on its
 *  side (already at/past both copies — the strip's own edge): fall back to
 *  whichever candidate is numerically nearest, accepting one short-way roll
 *  rather than breaking. */
function nextReelIndex(current: number, digit: number, direction: 1 | -1 | 0): number {
  const low = digit; // first copy: cells 0-9
  const high = digit + 10; // second copy: cells 10-19

  if (direction === 1) {
    if (low > current) return low;
    if (high > current) return high;
  } else if (direction === -1) {
    if (high < current) return high;
    if (low < current) return low;
  }

  return Math.abs(low - current) <= Math.abs(high - current) ? low : high;
}

function DigitColumn({ digit, direction }: { digit: number; direction: 1 | -1 | 0 }) {
  // Absolute cell index into the 20-cell strip, initialised to the digit's
  // own value (its cell in the first copy) — the column starts at rest,
  // never mid-roll.
  const [index, setIndex] = useState<number>(digit);
  const prevDigitRef = useRef(digit);
  // For one render after a 10-19 -> 0-9 renormalisation, the strip must not
  // visibly animate the jump — see handleTransitionEnd below.
  const [suppressTransition, setSuppressTransition] = useState(false);

  useEffect(() => {
    if (digit === prevDigitRef.current) return;
    prevDigitRef.current = digit;
    setIndex((current) => nextReelIndex(current, digit, direction));
    // `direction` is read, not depended on for equality — a digit that
    // hasn't changed must not re-roll just because the caller's inferred
    // direction flipped (e.g. a sibling column's press vs. an HA update).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digit]);

  // Once a roll into the second copy (index 10-19) finishes, silently fold it
  // back into 0-9 so the NEXT roll still has a full copy on each side to
  // search — without this, a few increments in a row would walk the index
  // off the top of the strip. The fold has to be invisible: dropping straight
  // from `transform: translateY(-13em)` to the equivalent `-3em` in the same
  // frame would be a visible snap. Rendering the strip with `transition:
  // "none"` for exactly one render, then clearing that in a
  // requestAnimationFrame, lands the equivalent transform before the next
  // paint with no transition running to animate the (fake) jump.
  function handleTransitionEnd() {
    setIndex((current) => {
      if (current < 10) return current;
      setSuppressTransition(true);
      requestAnimationFrame(() => setSuppressTransition(false));
      return current - 10;
    });
  }

  return (
    <span className="kiosk-reel-window" style={{ height: "1em" }}>
      <span
        className="kiosk-reel-strip"
        style={suppressTransition ? { transform: `translateY(-${index}em)`, transition: "none" } : { transform: `translateY(-${index}em)` }}
        onTransitionEnd={handleTransitionEnd}
      >
        {/* Under prefers-reduced-motion, globals.css drops .kiosk-reel-strip's
            transition entirely (no JS branch needed here) — the transform
            above is still applied, so the reel still LANDS on the right
            digit, it just snaps there instead of turning. */}
        {REEL_CELLS.map((cellDigit, i) => (
          <span key={i} style={{ display: "block", height: "1em", lineHeight: 1 }}>
            {cellDigit}
          </span>
        ))}
      </span>
    </span>
  );
}

const DIGIT_RE = /[0-9]/;

/**
 * Renders `text` character by character: a digit becomes a rolling
 * `DigitColumn`, anything else (`.`, `°`, `C`/`F`, `-`, a space) is a plain
 * static glyph beside it.
 *
 * Columns are keyed by their character INDEX in `text`, not by digit value —
 * this is what makes a changing digit COUNT (9.5 -> 10.0) safe rather than a
 * crash: React reconciles by (key, element type) at each position, so when a
 * position's character changes from a digit to punctuation or vice versa
 * (".", -> "0" when a tens digit appears), the element type at that key
 * changes and React unmounts the old node and mounts the new one fresh — a
 * new column mounting at rest, never animating from garbage.
 */
export function KioskDigitReel({
  text,
  direction,
  className,
}: {
  text: string;
  /** +1 the value went up, -1 it went down, 0 unknown/initial. Drives which
   *  way each digit column turns. */
  direction: 1 | -1 | 0;
  className?: string;
}) {
  // leading-none: makes "1em" exactly one reel cell tall. Verified against
  // both call sites (text-base on the tile, text-3xl in the modal) — an
  // element's own text-* class always sets its own font-size/line-height,
  // and leading-none simply zeroes THIS element's line-height on top of
  // whichever size the call site already chose, so it doesn't fight either.
  return (
    <span className={cn("leading-none", className)}>
      {Array.from(text).map((ch, i) =>
        DIGIT_RE.test(ch) ? (
          <DigitColumn key={i} digit={Number(ch)} direction={direction} />
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </span>
  );
}
