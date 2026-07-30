"use client";

import { cn } from "@/lib/utils";
import { formatRate } from "@/lib/format";
import type { TelemetrySample } from "@/lib/telemetry-types";

/**
 * Throughput is bidirectional, so it gets a bidirectional chart: receive above a
 * shared baseline, transmit mirrored below it. Two stacked sparklines would say
 * the same thing in twice the space and make "is this box pulling or pushing?" a
 * comparison between two separate y-scales instead of a glance at one shape.
 */

/** Down = received. The arrows are load-bearing: every rate readout on this page
 *  uses the same pair, so direction never has to be spelled out in words. */
export const RX_GLYPH = "↓";
export const TX_GLYPH = "↑";

export interface RateSeries {
  rx: number[];
  tx: number[];
}

/**
 * Pulls one interface's rate history out of the telemetry ring, keeping the
 * series length equal to samples.length so every chart on the page shares an
 * x-axis. A tick where the host counters were unreadable contributes 0 rather
 * than shortening the series — a gap in a 60-second window reads as a quiet
 * moment, which is the honest interpretation of "we could not measure".
 */
export function interfaceSeries(samples: TelemetrySample[], iface: string): RateSeries {
  const rx: number[] = [];
  const tx: number[] = [];
  for (const sample of samples) {
    const row = sample.interfaces?.[iface];
    rx.push(row && Number.isFinite(row.rxRate) ? row.rxRate : 0);
    tx.push(row && Number.isFinite(row.txRate) ? row.txRate : 0);
  }
  return { rx, tx };
}

/** Window peak across both directions — the denominator every chart scales to,
 *  and the number printed beside it so nobody reads two charts' heights against
 *  each other. Floored at 1 B/s so an idle interface divides safely. */
export function seriesPeak(series: RateSeries): number {
  return Math.max(1, ...series.rx, ...series.tx);
}

function areaPath(values: number[], peak: number, width: number, mid: number, amplitude: number, sign: 1 | -1): string {
  if (values.length < 2) return "";
  const step = width / (values.length - 1);
  let d = `M 0 ${mid}`;
  for (let i = 0; i < values.length; i++) {
    const y = mid - sign * (Math.min(values[i], peak) / peak) * amplitude;
    d += ` L ${(i * step).toFixed(2)} ${y.toFixed(2)}`;
  }
  d += ` L ${width} ${mid} Z`;
  return d;
}

function linePath(values: number[], peak: number, width: number, mid: number, amplitude: number, sign: 1 | -1): string {
  if (values.length < 2) return "";
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const y = mid - sign * (Math.min(v, peak) / peak) * amplitude;
      return `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function ThroughputChart({
  series,
  peak,
  height = 72,
  className,
  reveal = false,
}: {
  series: RateSeries;
  peak: number;
  height?: number;
  className?: string;
  /** One authored entrance, used once per page on the uplink band. */
  reveal?: boolean;
}) {
  const W = 320;
  const mid = height / 2;
  const amplitude = mid - 2;
  const ready = series.rx.length >= 2;

  if (!ready) {
    return (
      <div
        className={cn("flex items-center justify-center text-ink-faint text-xs", className)}
        style={{ height }}
      >
        collecting…
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full block", reveal && "net-reveal", className)}
      style={{ height }}
      aria-hidden
    >
      <path d={areaPath(series.rx, peak, W, mid, amplitude, 1)} fill="var(--color-accent)" opacity={0.16} />
      <path d={areaPath(series.tx, peak, W, mid, amplitude, -1)} fill="var(--color-blue)" opacity={0.16} />
      <path
        d={linePath(series.rx, peak, W, mid, amplitude, 1)}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={linePath(series.tx, peak, W, mid, amplitude, -1)}
        fill="none"
        stroke="var(--color-blue)"
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
      />
      {/* Baseline last so it reads as the axis both directions hang off, not as
          a line buried under two fills. */}
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--color-line-bright)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The ↓rx / ↑tx pair in the app's mono idiom. `size="lg"` for the uplink headline. */
export function RateReadout({
  rx,
  tx,
  size = "sm",
  className,
}: {
  rx: number;
  tx: number;
  size?: "sm" | "lg";
  className?: string;
}) {
  const big = size === "lg";
  return (
    <div className={cn("flex items-baseline gap-3 font-mono tabular-nums", big ? "text-base" : "text-xs", className)}>
      <span className="text-accent whitespace-nowrap">
        <span className={cn("text-ink-faint mr-1", big && "text-sm")}>{RX_GLYPH}</span>
        {formatRate(rx)}
      </span>
      <span className="text-blue whitespace-nowrap">
        <span className={cn("text-ink-faint mr-1", big && "text-sm")}>{TX_GLYPH}</span>
        {formatRate(tx)}
      </span>
    </div>
  );
}
