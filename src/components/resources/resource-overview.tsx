"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { SegmentButton } from "@/components/ui/segment-button";
import { cn } from "@/lib/utils";
import { SERIES_SLOTS, assignSlots, layoutEndLabels, type SeriesSlot } from "@/lib/chart-series";
import { relativeTime } from "@/lib/format";
import { snapScale } from "@/lib/watchlist";

export interface OverviewSegment {
  key: string;
  label: string; // e.g. "containers", "other", "free", "read", "write"
  value: number;
  fill: string; // caller passes an existing token colour
  /** Pre-formatted value for the hover title, e.g. "4.2 GB" or "3.1 MB/s". The caller
   *  owns formatting; without it the title falls back to the label alone. */
  display?: string;
}

export interface OverviewModel {
  /** Bar denominator: a real capacity total, or the 60s peak for rate metrics. */
  scale: number;
  segments: OverviewSegment[];
  /** Pre-formatted compact-line summary, e.g. "12% of 16 cores" or "3.1 MB/s". */
  headline: string;
  /** Pre-formatted caption under the bar, e.g. "peak 12.1 MB/s · 60s window". */
  caption: string;
  /** Labelled figures shown when expanded. */
  figures: { label: string; value: string }[];
  /** Optional 60-sample series for rate metrics. */
  series?: number[];
  /** Stated limitation, e.g. "host disk I/O unavailable — showing container totals only". */
  caveat?: string;
}

/** Clamp a segment's bar-width percentage. Guards the scale<=0 case (e.g. a rate
 * metric before its first 60s peak is known) so it returns 0 instead of NaN/Infinity. */
function segmentWidthPct(value: number, scale: number): number {
  if (scale <= 0) return 0;
  const pct = (value / scale) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/**
 * One presentational grammar for a resource metric: a collapsed headline row that
 * expands into a segmented capacity bar, legend, figures grid, optional trend
 * sparkline, and optional caveat. Contains no metric-specific knowledge — all
 * maths, formatting and labelling happens in the caller via OverviewModel.
 */
export function ResourceOverview({
  title,
  model,
  className,
}: {
  title: string;
  model: OverviewModel;
  className?: string;
}) {
  // Open by default: the host context is the point of the panel, not an optional
  // detail — collapsing it hid the answer behind a tap.
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();

  const hasScale = model.scale > 0;
  const noData = model.segments.length === 0 && !hasScale;

  return (
    <div className={cn("panel p-4", className)}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="w-full flex items-center justify-between gap-3 min-h-11 md:min-h-0 text-left cursor-pointer"
      >
        <span className="microlabel shrink-0">{title}</span>
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-ink truncate">{model.headline}</span>
          <ChevronDown
            size={13}
            className={cn(
              "text-ink-faint transition-transform duration-200 ease-out motion-reduce:transition-none shrink-0",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>

      <div
        id={contentId}
        aria-hidden={!expanded}
        // Instant: the chevron turn is the feedback, and a height tween would reflow every panel below it.
        className={expanded ? "mt-3" : "hidden"}
      >
        <div className="overflow-hidden">
          <div className="space-y-3">
            {!noData && (
              <div className="h-5 rounded-md overflow-hidden flex gap-[2px] bg-line">
                {hasScale &&
                  model.segments.map((seg) => {
                    const pct = segmentWidthPct(seg.value, model.scale);
                    const showLabel = pct >= 9;
                    return (
                      <div
                        key={seg.key}
                        title={seg.display ? `${seg.label} · ${seg.display}` : seg.label}
                        className="h-full flex items-center justify-center px-1 overflow-hidden"
                        style={{ width: `${pct}%`, background: seg.fill }}
                      >
                        {showLabel && (
                          <span className="text-[0.625rem] font-medium truncate text-ink">{seg.label}</span>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            {model.segments.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {model.segments.map((seg) => (
                  <div key={seg.key} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: seg.fill }} />
                    <span className="microlabel">{seg.label}</span>
                  </div>
                ))}
              </div>
            )}

            {model.caption && <div className="microlabel">{model.caption}</div>}

            {model.figures.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
                {model.figures.map((f) => (
                  <div key={f.label} className="min-w-0">
                    <div className="microlabel truncate">{f.label}</div>
                    <div className="font-mono text-xs text-ink mt-0.5 truncate">{f.value}</div>
                  </div>
                ))}
              </div>
            )}

            {model.series && model.series.length > 0 && (
              <div>
                <div className="microlabel mb-1">60s trend</div>
                <Sparkline values={model.series} width={160} height={32} className="text-accent" />
              </div>
            )}

            {model.caveat && <div className="microlabel !text-warn/80">{model.caveat}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Metrics history — CPU/MEM tabs only. Every range (LIVE, 1H, 24H, 7D)
 * renders the same multi-series HistoryChart; LIVE is fed the SSE ring, the
 * others the buckets fetched from /api/telemetry/history (see resources/page.tsx, which
 * owns the fetch and the range/selection state — this file only renders).
 * ------------------------------------------------------------------------- */

export type HistoryRangeOption = "live" | "1h" | "24h" | "7d";

const HISTORY_RANGES: readonly { value: HistoryRangeOption; label: string }[] = [
  { value: "live", label: "LIVE" },
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
];

/** 16x8 line swatch in the slot's colour and dash (a CSS border can't draw a 5 4 dash at this size). */
export function SeriesSwatch({ slot }: { slot: SeriesSlot }) {
  return (
    <svg width={16} height={8} viewBox="0 0 16 8" className="shrink-0" aria-hidden>
      <line x1={0} y1={4} x2={16} y2={4} stroke={slot.stroke} strokeWidth={2} strokeDasharray={slot.dash} />
    </svg>
  );
}

export function HistoryRangeControl({
  value,
  onChange,
}: {
  value: HistoryRangeOption;
  onChange: (v: HistoryRangeOption) => void;
}) {
  return (
    <div className="panel p-1 grid grid-cols-4 gap-1 w-full md:flex md:w-fit" role="group" aria-label="History range">
      {HISTORY_RANGES.map((r) => (
        <SegmentButton key={r.value} active={value === r.value} onClick={() => onChange(r.value)} label={r.label}>
          {r.label}
        </SegmentButton>
      ))}
    </div>
  );
}

/** Compare slots, one assignment for the chart and the watchlist rows. Slot 0 is the host;
 *  a compare keeps its slot until removed (colour follows the entity, never its rank). */
export function useCompareSlots(selected: string[]): ReadonlyMap<string, number> {
  const held = useRef<ReadonlyMap<string, number>>(new Map());
  const slots = assignSlots(selected, held.current, 1);
  held.current = slots;
  return slots;
}

export interface HistoryLineSeries {
  key: string;
  label: string;
  slot: SeriesSlot;
  points: (number | null)[];
}

const PLOT_PAD = 2; // keeps the 0 and 100% rules fully inside the plot
const yOf = (v: number, H: number, yMax: number) => H - PLOT_PAD - (Math.max(0, v) / yMax) * (H - 2 * PLOT_PAD);

/** One line path (and its closed area down to the baseline) per contiguous non-null run — a gap in
 *  the data breaks the path rather than being bridged across (Hatch-Not-Empty rule: an absent
 *  measurement must never be drawn as though it were a flat reading). */
function buildSegments(points: (number | null)[], width: number, height: number, yMax: number) {
  const n = points.length;
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  points.forEach((v, i) => {
    if (v == null) {
      if (current.length) runs.push(current);
      current = [];
      return;
    }
    current.push({ x: n > 1 ? (i / (n - 1)) * width : 0, y: yOf(v, height, yMax) });
  });
  if (current.length) runs.push(current);
  const base = height - PLOT_PAD;
  return runs.map((r) => {
    const d = r.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return { d, area: `${d} L${r[r.length - 1].x.toFixed(1)},${base} L${r[0].x.toFixed(1)},${base} Z` };
  });
}

const END_LABEL_GAP = 14;

/** Direct end labels: one per series with data, at its last value's height, nudged at least 14px apart. */
function endLabels(series: HistoryLineSeries[], H: number, yMax: number) {
  const rows = series
    .map((s) => {
      const last = [...s.points].reverse().find((v): v is number => v != null);
      return last === undefined ? null : { s, last, y: yOf(last, H, yMax) };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.y - b.y);
  const ys = layoutEndLabels(rows.map((r) => r.y), H, END_LABEL_GAP);
  return rows.map((r, i) => ({ ...r, y: ys[i] }));
}

const W = 600;

function HistoryChart({
  series,
  height = 180,
  yMax,
  formatAxis,
  formatValue,
}: {
  series: HistoryLineSeries[];
  height?: number;
  yMax: number;
  formatAxis: (v: number) => string;
  formatValue: (v: number) => string;
}) {
  const H = height;
  const labels = endLabels(series, H, yMax);
  return (
    <div
      className="grid grid-cols-[40px_minmax(0,1fr)_112px] md:grid-cols-[52px_minmax(0,1fr)_168px] gap-2"
      style={{ height: H }}
    >
      <div aria-hidden className="flex flex-col justify-between items-end font-mono text-[0.625rem] leading-none text-ink-faint">
        <span>{formatAxis(yMax)}</span>
        <span>{formatAxis(yMax / 2)}</span>
        <span>{formatAxis(0)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="min-w-0 w-full block" style={{ height: H }}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={yOf(yMax * f, H, yMax)} y2={yOf(yMax * f, H, yMax)} stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) =>
          buildSegments(s.points, W, H, yMax).map(({ d, area }, i) => (
            <g key={`${s.key}-${i}`}>
              {s.key === "host" && <path d={area} fill="var(--color-accent)" fillOpacity={0.14} stroke="none" />}
              <path
                d={d}
                fill="none"
                stroke={s.slot.stroke}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeDasharray={s.slot.dash}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )),
        )}
        <line x1={0} x2={W} y1={H - PLOT_PAD} y2={H - PLOT_PAD} stroke="var(--color-line-bright)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div aria-hidden="true" className="relative min-w-0" style={{ height: H }}>
        {labels.map(({ s, last, y }) => (
          <div key={s.key} className="absolute left-0 right-0 flex items-center gap-1 -translate-y-1/2 leading-[13px]" style={{ top: y }}>
            <SeriesSwatch slot={s.slot} />
            <span title={s.label} className="font-mono text-[0.625rem] text-ink-dim truncate">{`${s.label} ${formatValue(last)}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryLegend({ series }: { series: HistoryLineSeries[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {series.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5 min-w-0">
          <SeriesSwatch slot={s.slot} />
          <span className="microlabel truncate max-w-[9rem]">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface MetricHistoryPanelProps {
  range: HistoryRangeOption;
  selectedContainers: string[];
  /** From useCompareSlots, shared with the watchlist rows. */
  slots: ReadonlyMap<string, number>;
  /** Points aligned 1:1 with `bucketTimes`; null values are gaps. For LIVE the caller
   *  passes the SSE ring (one point per sample), for 1H/24H/7D the fetched buckets. */
  hostPoints: (number | null)[] | undefined;
  containerPoints: Record<string, (number | null)[]>;
  bucketTimes: number[];
  formatValue: (v: number) => string;
  /** Compact value for the y-axis (40px column on a phone). */
  formatAxis: (v: number) => string;
  /** Scale steps the y-axis max snaps to (CPU_STEPS or MEM_STEPS). */
  steps: readonly number[];
  recordingSince: number | null;
  isLoading: boolean;
}

/** One hour: the threshold below which the "recording since" honesty note
 *  stays up regardless of which range is selected — a 7D chart drawn from 12
 *  minutes of real samples is technically correct and practically misleading. */
const THIN_HISTORY_MS = 60 * 60 * 1000;

const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

/** The band's lower half: compare picker, chart, legend and the one-line hint (reserved height, never shifts). */
export function MetricHistoryPanel({
  range,
  selectedContainers,
  slots,
  hostPoints,
  containerPoints,
  bucketTimes,
  formatValue,
  formatAxis,
  steps,
  recordingSince,
  isLoading,
}: MetricHistoryPanelProps) {
  const isLive = range === "live";
  const isThin = recordingSince == null || Date.now() - recordingSince < THIN_HISTORY_MS;

  const series: HistoryLineSeries[] = [];
  if (hostPoints) series.push({ key: "host", label: "box", slot: SERIES_SLOTS[0], points: hostPoints });
  selectedContainers.forEach((name) => {
    series.push({
      key: name,
      label: name,
      slot: SERIES_SLOTS[slots.get(name) ?? 1],
      points: containerPoints[name] ?? bucketTimes.map(() => null),
    });
  });

  const noData = series.every((s) => s.points.every((v) => v == null));
  const showChart = isLive ? selectedContainers.length > 0 : !isThin && !(isLoading && noData);

  let hint = "";
  if (isLive) hint = selectedContainers.length ? "Live: the last 60 readings." : "Pick up to 4 containers with Compare to chart them here.";
  else if (recordingSince == null) hint = "Recording starts on the next telemetry tick. Check back in about a minute.";
  else if (isThin) hint = `Recording since ${relativeTime(recordingSince)}: a fuller picture needs about an hour.`;
  else if (isLoading && noData) hint = "Loading history…";
  else if (bucketTimes.length > 0 && recordingSince > bucketTimes[0]) {
    hint = `Recording since ${utc(recordingSince)} UTC: the start of this window has no data yet (gap, not zero).`;
  }

  const dataMax = Math.max(0, ...series.flatMap((s) => s.points.filter((v): v is number => v != null)));
  const top = snapScale(dataMax, steps);
  const yMax = dataMax > top ? dataMax : top; // a value over the top step is never clipped

  return (
    <div className="space-y-3">
      {showChart && <HistoryChart series={series} yMax={yMax} formatAxis={formatAxis} formatValue={formatValue} />}
      {showChart && series.length >= 2 && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <HistoryLegend series={series} />
          {!isLive && bucketTimes.length > 1 && <div className="microlabel">{relativeTime(bucketTimes[0])} → now</div>}
        </div>
      )}
      <p className="text-2xs text-ink-dim min-h-[1.05rem] m-0">{hint}</p>
    </div>
  );
}
