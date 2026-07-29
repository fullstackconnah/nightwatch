"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { cn } from "@/lib/utils";

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
  const [expanded, setExpanded] = useState(false);
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
