import { cn } from "@/lib/utils";

/** Floor for the y-domain upper bound: keeps an all-zero/flat series from dividing by
 * zero and producing NaN path coordinates — it renders a flat baseline instead. */
const MIN_DOMAIN = 1e-6;

/** Replaces non-finite samples (NaN/Infinity from a delta/elapsed rate calc) with 0
 * so a single bad sample never breaks the whole path. */
function toFinite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** Builds the "M x,y L x,y ..." point list for the stroked line, plus the closed
 * area path underneath it, given a pixel box and a 0..yMax value domain. */
function buildPaths(values: number[], width: number, height: number, yMax: number) {
  const points =
    values.length === 1
      ? [
          { x: 0, y: height - (toFinite(values[0]) / yMax) * height },
          { x: width, y: height - (toFinite(values[0]) / yMax) * height },
        ]
      : values.map((raw, i) => ({
          x: (i / (values.length - 1)) * width,
          y: height - (toFinite(raw) / yMax) * height,
        }));

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  // Drop the leading "M" (1 char) and replay every point as an "L" segment, starting
  // from the bottom-left baseline and closing back down at the bottom-right.
  const area = `M${first.x},${height} L${line.slice(1)} L${last.x},${height} Z`;

  return { line, area };
}

/**
 * Tiny high-density line chart for the last N telemetry samples of one metric.
 * No hooks, no browser APIs — safe to render from a server component.
 */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  max,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  max?: number;
  className?: string;
}) {
  if (values.length === 0) return null;

  const finiteValues = values.map(toFinite);
  const yMax = Math.max(max ?? Math.max(...finiteValues), MIN_DOMAIN);
  const { line, area } = buildPaths(values, width, height, yMax);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      shapeRendering="geometricPrecision"
      aria-hidden="true"
      className={cn(className)}
    >
      <path d={area} fill="currentColor" fillOpacity={0.15} stroke="none" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Appends `next` to `prev` without mutating it, trimmed to the last `cap` samples.
 * Backing store for the client-side rolling history ring shown by Sparkline.
 */
export function pushRolling(prev: number[], next: number, cap = 60): number[] {
  if (cap <= 0) return [];
  return [...prev, next].slice(-cap);
}
