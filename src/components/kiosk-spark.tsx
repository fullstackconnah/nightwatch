"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/kiosk-motion";

/**
 * Ambient trend charts for kiosk-vitals.tsx: a smoothed, gliding sparkline
 * (one series) and a bidirectional pair (receive/transmit). Both draw from
 * useKioskVitalsHistory's client-side ring buffer (kiosk-client.ts) — there
 * is no server-side time series to plot, only the last HISTORY_CAPACITY
 * instants this buffer has kept.
 *
 * Colour is `currentColor`, following the newer of the two sparkline
 * implementations in this repo (src/components/sparkline.tsx) rather than
 * charts.tsx's older Sparkline, which takes a `stroke` prop — currentColor
 * lets the caller set the hue with an ordinary text-* class instead of
 * threading a CSS variable string through a prop.
 */

// Same vertical viewport for every chart in this file: 100 user units wide
// (arbitrary — preserveAspectRatio="none" stretches it to whatever CSS width
// the caller gives it) so pixel math below stays independent of layout.
const W = 100;

/**
 * Catmull-Rom -> cubic Bezier conversion (uniform, tension = 1/6 — the
 * standard conversion when there are no authored per-point tangents to draw
 * from). This is what makes a new sample glide onto the chart instead of
 * hard-cornering onto it: a plain polyline (charts.tsx's Sparkline, or the
 * `L`-only path this file's own area fills still use) draws every vertex as
 * a corner, but a live percentage or byte rate is a continuous quantity and
 * should read like one — "animate the SVG path points using smooth curve
 * interpolation so incoming data glides smoothly across the graph rather
 * than jumping step-by-step."
 *
 * The one thing an unclamped Catmull-Rom tangent can do wrong: a sharp
 * spike's tangent can overshoot past its neighbours, placing a control
 * point below the chart's floor or above its ceiling — a curve inventing a
 * reading the host never reported. Every control point's y is clamped back
 * into [minY, maxY] (the drawable box, or half of it for the mirrored pair)
 * before it reaches the path string. Only the CONTROL points are clamped,
 * never the data points themselves, so the curve still passes exactly
 * through every real sample; it just can't bow past the box to get there.
 */
function smoothPath(points: { x: number; y: number }[], minY: number, maxY: number): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }
  const clampY = (y: number) => Math.min(maxY, Math.max(minY, y));
  const n = points.length;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    // Duplicate the end neighbour when there isn't a real one (i === 0 or
    // i === n - 2): the standard Catmull-Rom boundary handling, and the
    // reason the very first/last segment bows slightly less than an
    // interior one — there's no real tangent data past the edge of the
    // buffer yet.
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/** x-step for N points, reserving one EXTRA sample's worth of width beyond
 *  the right edge (see the "why W/(N-2)" comment on buildSmoothPaths) —
 *  shared by both exports so the pair's two series and the single spark all
 *  glide by the exact same distance. */
function stepFor(n: number): number {
  return n > 2 ? W / (n - 2) : W / Math.max(1, n - 1);
}

/** y for one value in a single-series chart: 0% sits near the floor, `peak`
 *  sits near the ceiling, both inset by 3 units — the exact inset charts.tsx's
 *  Sparkline uses (`H - 3 - (v/peak) * (H - 8)`), kept for visual consistency
 *  across every stat chart in the kiosk, not just this file's two. */
function valueToY(v: number, peak: number, H: number): number {
  const clamped = Math.max(0, Math.min(v, peak));
  return H - 3 - (clamped / peak) * (H - 8);
}

function buildSmoothPaths(values: number[], H: number, peak: number): { line: string; area: string; step: number } {
  const step = stepFor(values.length);
  // Space points as if one more sample existed than actually does: the
  // rightmost REAL point then always sits one step past the visible right
  // edge (x = W .. W+step), clipped by the <svg>'s own viewport (see
  // KioskSpark's `overflow: hidden`, chosen over an explicit <clipPath> —
  // a clip-path on the same element that also carries the glide's
  // `transform` has spec-ambiguous ordering between the two; the svg
  // viewport's own clip is unaffected by any child's transform, so nesting
  // the animated <g> inside it sidesteps that question entirely). The
  // result: the curve is always mid-flight through the clip boundary at
  // rest, instead of dead-ending flush with it — a curve that stops exactly
  // on the edge reads as "that's the whole chart," not "more is coming."
  const points = values.map((v, i) => ({ x: i * step, y: valueToY(v, peak, H) }));
  const line = smoothPath(points, 0, H);
  const first = points[0];
  const last = points[points.length - 1];
  // Close the fill down to the floor and back — same "drop the leading M,
  // replay as L" trick src/components/sparkline.tsx's buildPaths uses; it
  // works unchanged whether the interior commands are `L` or `C`.
  const area = `M${first.x},${H} L${line.slice(1)} L${last.x},${H} Z`;
  return { line, area, step };
}

/**
 * Same idea as buildSmoothPaths, but for one half of the mirrored pair: the
 * y-domain is `[mid, mid ± amplitude]` instead of `[0, H]`, and control
 * points are clamped to THIS HALF's own lane only (never past `mid`) — a
 * receive spike's smoothing overshoot must not visually bleed across the
 * baseline into the transmit lane, or vice versa.
 */
function buildMirroredSmoothPaths(
  values: number[],
  mid: number,
  amplitude: number,
  peak: number,
  sign: 1 | -1,
): { line: string; area: string; step: number } {
  const step = stepFor(values.length);
  const points = values.map((v, i) => {
    const clamped = Math.max(0, Math.min(v, peak));
    return { x: i * step, y: mid - sign * (clamped / peak) * amplitude };
  });
  const minY = sign === 1 ? mid - amplitude : mid;
  const maxY = sign === 1 ? mid : mid + amplitude;
  const line = smoothPath(points, minY, maxY);
  const first = points[0];
  const last = points[points.length - 1];
  const area = `M${first.x},${mid} L${line.slice(1)} L${last.x},${mid} Z`;
  return { line, area, step };
}

/**
 * Shared glide mechanism for both exports below: attaches to the animated
 * <g> and, whenever `sig` changes — a genuinely new sample landed, not just
 * an incidental re-render — jumps the group `stepPx` to the right with no
 * transition, then clears it one frame later WITH the transition on.
 *
 * Committing the offset before the transition exists is the whole mechanism.
 * Without it, both style writes land in one style recalculation, the
 * transition has nothing to interpolate away from (the "before" and "after"
 * it sees are both the resting transform), and it skips animating entirely.
 *
 * A `requestAnimationFrame` is NOT sufficient for that, and this was measured
 * rather than reasoned: with the rAF version, the group's inline transform
 * only ever reached `translateX(0px)` across a dense 26-second sample over
 * three poll boundaries, and its computed transform never left
 * `matrix(1, 0, 0, 1, 0, 0)` — i.e. the glide never ran once. The rAF
 * callback still fires inside the same style-flush window, so the coalescing
 * it was meant to prevent happens anyway.
 *
 * Forcing a synchronous style/layout read between the two writes is what
 * actually commits the offset. `getBoundingClientRect()` is the flush; the
 * `void` is there so it reads as a deliberate reflow rather than a stray
 * expression somebody can "clean up". This also removes the need for an rAF
 * handle and its cleanup entirely — the sequence is now synchronous, so
 * there is no pending callback that could fire after unmount.
 *
 * (kiosk-sunroom.tsx:250-259 defers by one rAF for a related but different
 * problem — it withholds a `transition` DECLARATION for a frame so the first
 * real value substitution lands instantly. That one works because the value
 * it is avoiding animating arrives on a later React commit, not in the same
 * synchronous block. It is not precedent for this.)
 *
 * `sig` is a length+last-value fingerprint rather than the `values` array
 * reference: the caller (kiosk-vitals.tsx) derives `values`/`rx`/`tx` with
 * `.map()` on every render, which allocates a new array even when the
 * underlying history hasn't grown, so reference equality would restart the
 * glide on any incidental re-render. A length+value fingerprint isn't
 * perfect either (a flat run of identical readings won't be told apart from
 * "no new sample"), but it means a poll that FAILED (buffer unchanged, same
 * trailing sample) never yanks the chart mid-transition.
 *
 * MUST BE CALLED UNCONDITIONALLY. Both callers below have an early return for
 * their "collecting…" state, and this hook used to sit after it — so a chart
 * went from 0 hooks to 2 the moment its second sample landed. React caught
 * that in the browser as `Internal React error: Expected static flag was
 * missing`, and the next hook added anywhere in these components would have
 * turned it into a hard "rendered more hooks than during the previous render"
 * crash on the wall panel. Keep every hook above the early returns.
 */
function useGlide(sig: string, stepPx: number, glideMs: number, reduced: boolean) {
  const ref = useRef<SVGGElement>(null);
  const prevSig = useRef<string | null>(null);

  useEffect(() => {
    const isFirst = prevSig.current === null;
    const changed = prevSig.current !== sig;
    prevSig.current = sig;
    if (reduced || isFirst || !changed) return; // reduced motion: render in place, per prefersReducedMotion's contract
    const g = ref.current;
    if (!g) return;
    g.style.transition = "none";
    g.style.transform = `translateX(${stepPx}px)`;
    void g.getBoundingClientRect();
    g.style.transition = `transform ${glideMs}ms linear`;
    g.style.transform = "translateX(0)";
  }, [sig, stepPx, glideMs, reduced]);

  return ref;
}

/** Exact wording + styling of charts.tsx's Sparkline "collecting…" state —
 *  one house idiom for "not enough samples yet," not two competing ones. */
function CollectingState({ height, className }: { height: number; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center text-ink-faint text-xs", className)} style={{ height }}>
      collecting…
    </div>
  );
}

export function KioskSpark({
  values,
  max,
  height = 22,
  glideMs = 5000,
  className,
  label,
}: {
  values: number[];
  /** Fixed ceiling (e.g. 100 for a percentage) so the line does not
   *  re-normalise itself every tick. */
  max?: number;
  height?: number;
  /** The poll interval. The glide takes exactly this long, so the chart is
   *  always mid-travel and never sits still waiting. */
  glideMs?: number;
  className?: string;
  /** The reading this chart draws, for the adjacent text/aria. */
  label: string;
}): ReactNode {
  const H = height;
  const reduced = prefersReducedMotion();

  /* EVERY HOOK ABOVE THE EARLY RETURN. The `collecting…` branch below used to
     sit before useGlide, which meant this component rendered 0 hooks until its
     second sample landed and 2 afterwards — see the MUST BE CALLED
     UNCONDITIONALLY note on useGlide for what React did about that. `sig` and
     `step` are both computable from `values.length` alone, so hoisting costs
     nothing but the guard on an empty array below. */
  const step = stepFor(values.length);
  // `?? ""` rather than a number: with no samples there is no trailing value,
  // and a fingerprint of "0:" is a perfectly good "nothing yet".
  const sig = `${values.length}:${values[values.length - 1] ?? ""}`;
  const groupRef = useGlide(sig, step, glideMs, reduced);

  // Fewer than 2 samples: DESIGN.md/charts.tsx precedent, not a third empty
  // state of this file's own invention. A poll that is failing outright is
  // the CALLER's job — kiosk-vitals.tsx already renders an error branch
  // above this component, so this never has to guess "no data" apart from
  // "not enough data yet."
  if (values.length < 2) {
    return <CollectingState height={H} className={className} />;
  }

  const allZero = values.every((v) => v === 0);
  // `Math.max(...[])` is -Infinity, so the spread needs the array to be
  // non-empty — guaranteed here by the early return above, but the `max`
  // prop is the normal path for a percentage series anyway.
  const peak = Math.max(max ?? Math.max(...values), 1e-6);
  const { line, area } = buildSmoothPaths(values, H, peak);

  return (
    <div className={cn("w-full", className)} style={{ height: H }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full block"
        // See buildSmoothPaths' comment: this is the chosen clip mechanism
        // (the svg viewport's own bound, explicit rather than relied-on) —
        // content drawn past x=W (the extra reserved sample, or the glide's
        // translateX overshoot) is cut here, not squeezed into view.
        style={{ height: H, overflow: "hidden" }}
        aria-hidden
      >
        {allZero ? (
          // "Measured, nothing moved" — a DASHED baseline, per DESIGN.md's
          // Hatch-Not-Empty Rule, so an idle series is never mistaken for a
          // failed chart.
          <line
            x1={0}
            y1={H - 3}
            x2={W}
            y2={H - 3}
            stroke="var(--color-line-bright)"
            strokeWidth={1}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <g ref={groupRef}>
            <path d={area} fill="currentColor" fillOpacity={0.15} stroke="none" />
            <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
      {/* The graphic is aria-hidden; this is the "adjacent text" that
          carries its meaning for a screen reader, per the house convention
          (Meter's sr-only value span is the same idea). */}
      <span className="sr-only">{label} trend</span>
    </div>
  );
}

export function KioskSparkPair({
  rx,
  tx,
  height = 26,
  glideMs = 5000,
  className,
  rxLabel = "download",
  txLabel = "upload",
}: {
  rx: number[];
  tx: number[];
  height?: number;
  glideMs?: number;
  className?: string;
  rxLabel?: string;
  txLabel?: string;
}): ReactNode {
  const H = height;
  const mid = H / 2;
  const amplitude = mid - 2;
  const reduced = prefersReducedMotion();

  // Hoisted above the early return for the same reason as KioskSpark's — see
  // useGlide's MUST BE CALLED UNCONDITIONALLY note.
  const sig = `${rx.length}:${rx[rx.length - 1] ?? ""}:${tx[tx.length - 1] ?? ""}`;
  const groupRef = useGlide(sig, stepFor(rx.length), glideMs, reduced);

  if (rx.length < 2) {
    return <CollectingState height={H} className={className} />;
  }

  const idle = rx.every((v) => v === 0) && tx.every((v) => v === 0);
  // ONE shared ceiling for both directions, never each series' own peak —
  // otherwise a 2 KB/s upload would draw exactly as tall as a 20 MB/s
  // download and the chart would misreport the ratio between them.
  const peak = Math.max(1e-6, ...rx, ...tx);

  const rxPaths = buildMirroredSmoothPaths(rx, mid, amplitude, peak, 1);
  const txPaths = buildMirroredSmoothPaths(tx, mid, amplitude, peak, -1);

  return (
    <div className={cn("w-full", className)} style={{ height: H }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full block"
        style={{ height: H, overflow: "hidden" }}
        aria-hidden
      >
        {idle ? (
          <line
            x1={0}
            y1={mid}
            x2={W}
            y2={mid}
            stroke="var(--color-line-bright)"
            strokeWidth={1}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <>
            <g ref={groupRef}>
              <path d={rxPaths.area} fill="var(--color-accent)" fillOpacity={0.16} stroke="none" />
              <path d={txPaths.area} fill="var(--color-blue)" fillOpacity={0.16} stroke="none" />
              <path d={rxPaths.line} fill="none" stroke="var(--color-accent)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
              <path d={txPaths.line} fill="none" stroke="var(--color-blue)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
            </g>
            {/* Baseline drawn LAST — after, so on top of, the glide group —
                and OUTSIDE it: it's the fixed zero-axis both directions hang
                off, not a moving data series, so it never joins the
                translateX shift the way rx/tx do. Matches net-throughput.tsx's
                ThroughputChart, which this pair otherwise mirrors. */}
            <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--color-line-bright)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <span className="sr-only">
        {rxLabel} and {txLabel} trend
      </span>
    </div>
  );
}
