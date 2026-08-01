"use client";

import { useMemo } from "react";
import { RX_GLYPH, TX_GLYPH, seriesIsIdle, seriesPeak, type RateSeries } from "@/components/net-throughput";
import { formatRate } from "@/lib/format";
import type { TelemetrySample } from "@/lib/telemetry-types";
import { cn } from "@/lib/utils";

/**
 * Up to four containers' throughput overlaid on one chart, from the exact
 * telemetry samples the footprint above already holds — no new fetch, no
 * longer window than the 60s ring actually carries (long-range comparison
 * waits for the metrics-history API, per the design doc's wave-2 note).
 *
 * Same bidirectional grammar as net-throughput.tsx's ThroughputChart (receive
 * above baseline, transmit mirrored below, 16% fill, 1.25px stroke, baseline
 * drawn last) but generalised to N colours, because that chart's fixed
 * accent/blue pair is deliberately not reusable for more than two series. The
 * area/line path builders below intentionally mirror that file's private
 * (unexported) ones — same math, so the two charts read as one family.
 */

const SERIES_COLORS = ["var(--color-accent)", "var(--color-blue)", "#14b8a6", "#0f766e"];

export interface CompareContainer {
  id: string;
  name: string;
}

interface CompareItem {
  id: string;
  name: string;
  color: string;
  series: RateSeries;
  /** True once this container id has appeared in at least one sample. False
   *  means "no samples yet" — a fresh/just-selected container, distinct from
   *  a container that is measured but genuinely idle. */
  measured: boolean;
  idle: boolean;
}

/** Mirrors net-throughput.tsx's interfaceSeries, keyed by container id
 *  instead of interface name. A namespace-sharing container (the gluetun
 *  group) is looked up by the footprint's own owner id, which reports its
 *  own valid rx/tx every tick — same reasoning ContainerFootprint's grouping
 *  comment documents. */
function containerRateSeries(samples: TelemetrySample[], id: string): { series: RateSeries; measured: boolean } {
  const rx: number[] = [];
  const tx: number[] = [];
  let measured = false;
  for (const sample of samples) {
    const row = sample.containers[id];
    if (row) measured = true;
    rx.push(row && Number.isFinite(row.rxRate) ? row.rxRate : 0);
    tx.push(row && Number.isFinite(row.txRate) ? row.txRate : 0);
  }
  return { series: { rx, tx }, measured };
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

function LegendSwatch({ item }: { item: CompareItem }) {
  const note = !item.measured ? "no samples yet" : item.idle ? "quiet" : formatRate(seriesPeak(item.series));
  return (
    <div className="flex items-center gap-1.5 min-w-0" title={`${item.name} — ${note}`}>
      {!item.measured ? (
        <span
          className="h-2 w-2 rounded-sm shrink-0 border border-line-bright"
          style={{
            backgroundImage: "repeating-linear-gradient(135deg, transparent 0 2px, var(--color-line-bright) 2px 3px)",
          }}
          aria-hidden
        />
      ) : (
        <span
          className={cn("h-2 w-2 rounded-sm shrink-0", item.idle && "opacity-40")}
          style={{ background: item.color }}
          aria-hidden
        />
      )}
      <span className="font-mono text-[0.65rem] text-ink-dim truncate">{item.name}</span>
      <span className="font-mono text-[0.65rem] text-ink-faint tabular-nums whitespace-nowrap">{note}</span>
    </div>
  );
}

export function NetCompare({
  containers,
  samples,
}: {
  /** In selection order — first selected gets accent, second gets blue, and
   *  so on, so the colour a container carries stays stable while it remains
   *  selected even if others are added or removed around it. */
  containers: CompareContainer[];
  samples: TelemetrySample[];
}) {
  const items = useMemo<CompareItem[]>(
    () =>
      containers.map((c, i) => {
        const { series, measured } = containerRateSeries(samples, c.id);
        return {
          id: c.id,
          name: c.name,
          color: SERIES_COLORS[i % SERIES_COLORS.length],
          series,
          measured,
          idle: seriesIsIdle(series),
        };
      }),
    [containers, samples],
  );

  if (items.length === 0) return null;

  const W = 320;
  const height = 128;
  const mid = height / 2;
  const amplitude = mid - 2;
  const ready = samples.length >= 2;
  const moving = items.filter((it) => it.measured && !it.idle);
  const allUnmeasured = items.every((it) => !it.measured);

  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold tracking-tight">Comparing {items.length}</h3>
        <span className="microlabel">
          60s window · {RX_GLYPH} received above · {TX_GLYPH} sent below
        </span>
      </div>

      <div className="mt-3">
        {!ready ? (
          <div className="flex items-center justify-center text-ink-faint text-xs" style={{ height }}>
            collecting…
          </div>
        ) : moving.length === 0 ? (
          <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full block" style={{ height }} aria-hidden>
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
          </svg>
        ) : (
          <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full block" style={{ height }} aria-hidden>
            {(() => {
              const peak = Math.max(1, ...moving.map((it) => seriesPeak(it.series)));
              return (
                <>
                  {moving.map((it) => (
                    <path
                      key={`${it.id}-rx-fill`}
                      d={areaPath(it.series.rx, peak, W, mid, amplitude, 1)}
                      fill={it.color}
                      opacity={0.16}
                    />
                  ))}
                  {moving.map((it) => (
                    <path
                      key={`${it.id}-tx-fill`}
                      d={areaPath(it.series.tx, peak, W, mid, amplitude, -1)}
                      fill={it.color}
                      opacity={0.16}
                    />
                  ))}
                  {items
                    .filter((it) => it.measured)
                    .map((it) => (
                      <g key={`${it.id}-lines`} opacity={it.idle ? 0.5 : 1}>
                        <path
                          d={linePath(it.series.rx, peak, W, mid, amplitude, 1)}
                          fill="none"
                          stroke={it.color}
                          strokeWidth={1.25}
                          strokeDasharray={it.idle ? "3 3" : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                        <path
                          d={linePath(it.series.tx, peak, W, mid, amplitude, -1)}
                          fill="none"
                          stroke={it.color}
                          strokeWidth={1.25}
                          strokeDasharray={it.idle ? "3 3" : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    ))}
                </>
              );
            })()}
            <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--color-line-bright)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>

      {ready && moving.length === 0 && (
        <p className="text-[0.7rem] text-ink-faint mt-1.5">
          {allUnmeasured
            ? "no samples yet for the selected containers"
            : "measured, nothing moved in the last 60s window"}
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-line/60">
        {items.map((it) => (
          <LegendSwatch key={it.id} item={it} />
        ))}
      </div>
    </section>
  );
}
