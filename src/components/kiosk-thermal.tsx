"use client";

/* THESIS: a running climate unit moves air, and nothing on the climate tile
   said so before this file existed. Four soft convection currents drift
   behind the tile's own figures — upward while heating, downward while
   cooling — so a glance across a row of tiles shows which rooms are actually
   working before anyone reads a mode label. See globals.css's "climate:
   thermal convection streams" block (KIOSK MOTION VOCABULARY) for the
   keyframes and the seamless-loop opacity ramp; this file only supplies the
   per-stream geometry and the mode → direction/colour decision, exactly the
   split kiosk-sunroom-weather.tsx already uses for its own layered fields
   (STARS is a module-level table there too). */

import { useEffect, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/kiosk-motion";

/** Per-stream geometry, held as a module-level table rather than inline JSX
 *  literals — the sunroom weather layer's own idiom (its STARS table) — so
 *  the four streams read as one authored field instead of four ad hoc divs.
 *  `left` spreads the streams across the tile; `width`/`height` vary a little
 *  so no two look like copies; `durationS` differs per stream so they never
 *  beat in sync; `delayS` is NEGATIVE per stream so the animation starts
 *  already mid-cycle on mount — without that, all four would fade in from
 *  the same phase together and read as one pulse instead of a continuous
 *  drift (the same reasoning the sunroom cloud/star fields use for their own
 *  negative delays). */
const THERMAL_STREAMS: ReadonlyArray<{
  left: string;
  width: string;
  height: string;
  durationS: number;
  delayS: number;
}> = [
  { left: "8%", width: "24%", height: "50%", durationS: 7.4, delayS: -1.8 },
  { left: "33%", width: "31%", height: "58%", durationS: 9.6, delayS: -4.2 },
  { left: "58%", width: "22%", height: "47%", durationS: 8.3, delayS: -2.6 },
  { left: "80%", width: "34%", height: "55%", durationS: 10.7, delayS: -6.1 },
];

/** Every stream sits at the same vertical start; the keyframes translate it
 *  ±55% from there, so this is the resting midpoint the whole travel is
 *  centred on, not a per-stream value. */
const STREAM_TOP = "22%";

export function KioskThermalField({
  hvacMode,
  currentTemp,
  targetTemp,
}: {
  hvacMode: string;
  currentTemp: number | null;
  targetTemp: number | null;
}): ReactNode {
  /* Never mount a frozen field: four stopped currents are four smudges on the
     tile, and a smudge does not mean "this unit is running" — the same
     reasoning kiosk-sunroom-weather.tsx uses for suppressing its rain layer
     outright rather than freezing it.

     READ IN AN EFFECT, NOT DURING RENDER. `prefersReducedMotion()` used to be
     called inline here, which made this component's own markup depend on a
     browser media query the server cannot see: the server rendered four
     streams, the client rendered none, and React reported "a tree hydrated but
     some attributes of the server rendered HTML didn't match the client
     properties" on every reduced-motion load (caught on the test stack; it was
     the only page error in the whole verification pass). Hydrating the flag in
     an effect means the server and the first client render agree — the field
     mounts, then unmounts a tick later if motion is unwanted.

     That one tick is invisible, and this is where globals.css's
     belt-and-braces rule stops being belt-and-braces and does real work: it
     already zeroes .kiosk-thermal-stream's opacity and animation under reduced
     motion, so the frame before this effect runs paints nothing. The two
     mechanisms are load-bearing together — remove the CSS rule and a
     reduced-motion user gets a single frame of four moving currents. */
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(prefersReducedMotion()), []);
  if (reduced) return null;

  // HaClimate carries no `hvacAction` field — `hvacMode` is the ONLY signal
  // this tile has for which way (if any) a unit is moving air, and its
  // informal value set is off | heat | cool | heat_cool | auto | dry |
  // fan_only. `heat`/`cool` say their own direction outright; `dry` and
  // `fan_only` genuinely have no thermal direction to draw (a dehumidifier
  // or a bare fan isn't heating or cooling the room), so they render nothing
  // rather than picking an arbitrary one — a stream that means nothing is
  // worse than no stream. `off` is the same "nothing" case for the obvious
  // reason, and anything unrecognised (a value this integration hasn't sent
  // yet) degrades the same way rather than guessing.
  let direction: "rise" | "fall" | null = null;
  let colorToken: string | null = null;

  if (hvacMode === "heat") {
    direction = "rise";
    colorToken = "var(--color-warn)";
  } else if (hvacMode === "cool") {
    direction = "fall";
    colorToken = "var(--color-blue)";
  } else if (hvacMode === "heat_cool" || hvacMode === "auto") {
    // Dual/self-managed modes don't say which way they're working — infer it
    // from the reading itself. Within 0.3° of target, or either value
    // missing, is treated as "not moving air in a direction anyone can
    // claim": a unit idling at its setpoint isn't visibly heating or
    // cooling, and a direction guessed from noise would be a lie told
    // confidently.
    if (currentTemp != null && targetTemp != null && Math.abs(currentTemp - targetTemp) > 0.3) {
      if (currentTemp < targetTemp) {
        direction = "rise";
        colorToken = "var(--color-warn)";
      } else {
        direction = "fall";
        colorToken = "var(--color-blue)";
      }
    }
  }

  if (direction === null || colorToken === null) return null;

  const animationName = direction === "rise" ? "kiosk-thermal-rise" : "kiosk-thermal-fall";

  return (
    // aria-hidden: purely decorative, adds nothing a screen reader needs (the
    // tile's own mode label already says "Heat"/"Cool" in text).
    //
    // -z-10 is REQUIRED, not cosmetic. An `absolute` element paints in step 8
    // of CSS's painting order — AFTER the inline text of its non-positioned
    // siblings (step 7) — so a plain `absolute inset-0` layer would paint
    // these streams OVER the tile's own temperature figures. A negative
    // z-index moves this layer to step 2, above the tile's background and
    // below its text, which only works because the tile root is a stacking
    // context (kiosk-climate.tsx's tile root gains `isolate` for exactly this
    // reason). Without `isolate` on an ancestor, a negative z-index escapes
    // to the nearest ANCESTOR stacking context instead of this local one, and
    // could paint behind the whole page rather than just behind this tile's
    // figures — the identical trap globals.css's own `.kiosk-leaks` comment
    // documents for the sunroom corner-light layer.
    //
    // overflow-hidden + rounded-tile: streams must not spill past the tile's
    // own rounded corners.
    //
    // No `position: fixed` descendant exists inside this layer to worry about
    // re-parenting via the streams' own `filter: blur()` — it has no children
    // at all beyond the four stream divs themselves.
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-tile">
      {THERMAL_STREAMS.map((stream, i) => (
        <div
          key={i}
          className="kiosk-thermal-stream"
          style={{
            left: stream.left,
            width: stream.width,
            height: stream.height,
            top: STREAM_TOP,
            // No literal colour: the hue is always one of the two tokens this
            // system already spends on hot/cool (--color-warn / --color-blue),
            // mixed down to a soft 26% so four overlapping streams don't
            // stack into a solid wash.
            background: `radial-gradient(closest-side, color-mix(in srgb, ${colorToken} 26%, transparent) 0%, transparent 78%)`,
            borderRadius: "9999px", // the pill value; never 999px
            filter: "blur(6px)",
            animationName,
            animationDuration: `${stream.durationS}s`,
            animationDelay: `${stream.delayS}s`,
          }}
        />
      ))}
    </div>
  );
}
