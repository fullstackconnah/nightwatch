import { cn } from "@/lib/utils";
import { gapPaths } from "@/lib/chart-points";

/** Floor for the y-domain upper bound: keeps an all-zero/flat series from dividing by
 * zero and producing NaN path coordinates — it renders a flat baseline instead. */
const MIN_DOMAIN = 1e-6;

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

  // NaN is the gap marker (seriesFor): the line breaks there, and the y domain ignores it.
  const finite = values.filter(Number.isFinite);
  const yMax = Math.max(max !== undefined && Number.isFinite(max) ? max : Math.max(...finite), MIN_DOMAIN);
  const paths = gapPaths(values, width, height, yMax);
  if (!paths) return null;
  const { line, area } = paths;

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
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
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
