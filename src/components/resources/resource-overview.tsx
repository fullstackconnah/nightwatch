"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { SegmentButton } from "@/components/ui/segment-button";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";

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
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 pointer-events-none",
        )}
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
 * Metrics history — CPU/MEM tabs only. LIVE reuses the 60s trend Sparkline
 * above (via OverviewModel.series); 1H/24H/7D render a longer multi-series
 * chart here, fed by /api/telemetry/history (see resources/page.tsx, which
 * owns the fetch and the range/selection state — this file only renders).
 * ------------------------------------------------------------------------- */

export type HistoryRangeOption = "live" | "1h" | "24h" | "7d";

const HISTORY_RANGES: readonly { value: HistoryRangeOption; label: string }[] = [
  { value: "live", label: "LIVE" },
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
];

/** accent (host) is applied by the caller; this is the order additional
 *  container series take — blue first, then two steps of the four-step teal
 *  ramp (DESIGN.md's ramp values, literal — the ramp is not a CSS token). */
const CONTAINER_SERIES_COLORS = ["var(--color-blue)", "#0f766e", "#0d9488", "#14b8a6"];

export function containerHistoryColor(index: number): string {
  return CONTAINER_SERIES_COLORS[index % CONTAINER_SERIES_COLORS.length];
}

export function HistoryRangeControl({
  value,
  onChange,
}: {
  value: HistoryRangeOption;
  onChange: (v: HistoryRangeOption) => void;
}) {
  return (
    <div className="panel p-1 flex gap-1 w-fit" role="group" aria-label="History range">
      {HISTORY_RANGES.map((r) => (
        <SegmentButton key={r.value} active={value === r.value} onClick={() => onChange(r.value)} label={r.label}>
          {r.label}
        </SegmentButton>
      ))}
    </div>
  );
}

/** Pill chips, up to `max` selected — the log rail's own chip shape
 *  (panel/panel-hover, h-11 md:h-8, horizontal snap on a phone) reused here,
 *  though the selection semantics are the opposite of the rail's "hollow to
 *  remove": here a chip fills in, with its assigned series colour, to ADD a
 *  container's line to the chart. */
export function ContainerHistoryPicker({
  options,
  selected,
  onToggle,
  max = 4,
}: {
  options: string[];
  selected: string[];
  onToggle: (name: string) => void;
  max?: number;
}) {
  const atCap = selected.length >= max;

  if (options.length === 0) return null;

  return (
    <div
      className="flex gap-1.5 flex-nowrap overflow-x-auto snap-x pb-1 md:flex-wrap md:overflow-x-visible md:pb-0"
      style={{ overscrollBehaviorX: "contain" }}
      role="group"
      aria-label="Compare containers"
    >
      {options.map((name) => {
        const idx = selected.indexOf(name);
        const isSelected = idx !== -1;
        const disabled = !isSelected && atCap;
        const color = isSelected ? containerHistoryColor(idx) : undefined;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onToggle(name)}
            aria-pressed={isSelected}
            disabled={disabled}
            title={disabled ? `Comparing ${max} already — remove one to add ${name}` : name}
            className={cn(
              "h-11 md:h-8 shrink-0 snap-start inline-flex items-center gap-1.5 rounded-md px-2.5",
              "outline-none focus-visible:ring-1 focus-visible:ring-accent cursor-pointer",
              isSelected ? "bg-accent/10 border border-accent/30" : "panel panel-hover",
              disabled && "opacity-40 cursor-not-allowed pointer-events-none",
            )}
          >
            {isSelected && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />}
            <span className="font-mono text-xs text-ink truncate max-w-[8rem]">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

interface HistoryLineSeries {
  key: string;
  label: string;
  color: string;
  points: (number | null)[];
}

/** Builds one "M.. L.." path per contiguous non-null run — a gap in the data
 *  breaks the path rather than being bridged across (Hatch-Not-Empty rule: an
 *  absent measurement must never be drawn as though it were a flat reading). */
function buildSegments(points: (number | null)[], width: number, height: number, yMax: number): string[] {
  const n = points.length;
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((v, i) => {
    if (v == null) {
      if (current.length) {
        segments.push(current.join(" "));
        current = [];
      }
      return;
    }
    const x = n > 1 ? (i / (n - 1)) * width : 0;
    const y = height - (Math.max(0, v) / yMax) * height;
    current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(" "));
  return segments;
}

function HistoryChart({
  series,
  height = 140,
}: {
  series: HistoryLineSeries[];
  height?: number;
}) {
  const W = 600;
  const H = height;
  const allValues = series.flatMap((s) => s.points.filter((v): v is number => v != null));
  const hasData = allValues.length > 0;
  const yMax = Math.max(...allValues, 1e-6);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className="w-full"
      style={{ height: H }}
    >
      <line x1={0} y1={H - 0.75} x2={W} y2={H - 0.75} stroke="var(--color-line-bright)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {hasData &&
        series.map((s) => {
          const values = s.points.filter((v): v is number => v != null);
          // A series with real samples but zero measured amplitude (idle, not
          // absent) draws dashed rather than solid — "measured, nothing moved"
          // must not read the same as "chart failed" or "no data" would.
          const isIdleFlat = values.length > 0 && values.every((v) => v === values[0]);
          const segments = buildSegments(s.points, W, H, yMax);
          return segments.map((d, i) => (
            <path
              key={`${s.key}-${i}`}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeDasharray={isIdleFlat ? "4 3" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ));
        })}
    </svg>
  );
}

function HistoryLegend({ series }: { series: HistoryLineSeries[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {series.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
          <span className="microlabel truncate max-w-[9rem]">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface MetricHistoryPanelProps {
  range: HistoryRangeOption;
  onRangeChange: (r: HistoryRangeOption) => void;
  containerOptions: string[];
  selectedContainers: string[];
  onToggleContainer: (name: string) => void;
  /** Bucketed points, aligned 1:1 with `bucketTimes`; null values are gaps.
   *  Undefined while the range is LIVE (nothing to fetch — the panel above
   *  already shows the 60s ring) or before the first response lands. */
  hostPoints: (number | null)[] | undefined;
  containerPoints: Record<string, (number | null)[]>;
  bucketTimes: number[];
  formatValue: (v: number) => string;
  recordingSince: number | null;
  isLoading: boolean;
}

/** One hour: the threshold below which the "recording since" honesty note
 *  stays up regardless of which range is selected — a 7D chart drawn from 12
 *  minutes of real samples is technically correct and practically misleading. */
const THIN_HISTORY_MS = 60 * 60 * 1000;

export function MetricHistoryPanel({
  range,
  onRangeChange,
  containerOptions,
  selectedContainers,
  onToggleContainer,
  hostPoints,
  containerPoints,
  bucketTimes,
  formatValue,
  recordingSince,
  isLoading,
}: MetricHistoryPanelProps) {
  const isLive = range === "live";
  const isThin = recordingSince == null || Date.now() - recordingSince < THIN_HISTORY_MS;

  const series: HistoryLineSeries[] = [];
  if (hostPoints) series.push({ key: "host", label: "host", color: "var(--color-accent)", points: hostPoints });
  selectedContainers.forEach((name, i) => {
    series.push({
      key: name,
      label: name,
      color: containerHistoryColor(i),
      points: containerPoints[name] ?? bucketTimes.map(() => null),
    });
  });

  const latestHost = hostPoints ? [...hostPoints].reverse().find((v) => v != null) : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <HistoryRangeControl value={range} onChange={onRangeChange} />
        {!isLive && latestHost != null && (
          <span className="font-mono text-xs text-ink">{formatValue(latestHost)}</span>
        )}
      </div>

      {!isLive && (
        <>
          <ContainerHistoryPicker options={containerOptions} selected={selectedContainers} onToggle={onToggleContainer} />

          {isThin ? (
            <div className="py-4 text-center">
              <p className="text-ink-dim text-xs">
                {recordingSince == null
                  ? "recording will start on the next telemetry tick — check back in about a minute"
                  : `recording since ${relativeTime(recordingSince)} — a fuller picture needs about an hour`}
              </p>
            </div>
          ) : isLoading && series.every((s) => s.points.every((v) => v == null)) ? (
            <div className="py-4 text-center text-ink-faint text-xs">loading history…</div>
          ) : (
            <div className="space-y-2">
              <HistoryChart series={series} />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <HistoryLegend series={series} />
                {bucketTimes.length > 1 && (
                  <div className="microlabel">
                    {relativeTime(bucketTimes[0])} → now
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
