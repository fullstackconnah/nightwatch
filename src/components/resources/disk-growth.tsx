"use client";

import { useState } from "react";
import useSWR from "swr";
import { SegmentButton } from "@/components/ui/segment-button";
import { SeriesSwatch } from "@/components/resources/resource-overview";
import { SERIES_SLOTS } from "@/lib/chart-series";
import { fetcher } from "@/lib/client";
import { formatBytes, relativeTime } from "@/lib/format";
import { cappedMounts, fastestGrowing, moreMountsNote } from "@/lib/resource-ui-view";

/**
 * DISK-tab growth panel (G5): mount used-bytes over time, read from G1's
 * metrics history (see metrics-history.ts's queryMountHistory, additive to
 * that module). One line per mount, same hand-rolled SVG grammar
 * resource-overview.tsx's MetricHistoryPanel already established (gap-broken
 * paths, hairline baseline), taking each mount's stroke and dash from the shared
 * SERIES_SLOTS in chart-series.ts rather than inventing a second palette for "compare N peers on
 * one chart".
 */

type GrowthRange = "24h" | "7d" | "14d";

const RANGES: readonly { value: GrowthRange; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "14d", label: "14D" },
];

interface MountHistoryBucket {
  t: number;
  usedBytes: number | null;
}
interface MountGrowthResponse {
  recordingSince: number | null;
  mounts: Record<string, MountHistoryBucket[]>;
}

/** One "M.. L.." path per contiguous non-null run — a gap breaks the path
 *  rather than bridging across it (Hatch-Not-Empty: an absent measurement
 *  must never be drawn as though it were a flat reading). */
function buildSegments(points: (number | null)[], width: number, height: number, yMin: number, yMax: number): string[] {
  const n = points.length;
  const range = Math.max(1e-6, yMax - yMin);
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
    const y = height - ((v - yMin) / range) * height;
    current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(" "));
  return segments;
}

function GrowthChart({ data, mountpoints }: { data: MountGrowthResponse; mountpoints: string[] }) {
  const W = 600;
  const H = 140;
  const allValues = mountpoints.flatMap((m) =>
    (data.mounts[m] ?? []).map((p) => p.usedBytes).filter((v): v is number => v != null),
  );
  const hasData = allValues.length > 0;
  const yMax = hasData ? Math.max(...allValues) * 1.05 : 1;
  const yMin = hasData ? Math.min(0, ...allValues) : 0;

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="w-full" style={{ height: H }}>
        <line
          x1={0}
          y1={H - 0.75}
          x2={W}
          y2={H - 0.75}
          stroke="var(--color-line-bright)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {hasData &&
          mountpoints.map((mount, i) => {
            const points = (data.mounts[mount] ?? []).map((p) => p.usedBytes);
            const segments = buildSegments(points, W, H, yMin, yMax);
            const slot = SERIES_SLOTS[i % SERIES_SLOTS.length];
            return segments.map((d, si) => (
              <path
                key={`${mount}-${si}`}
                d={d}
                fill="none"
                stroke={slot.stroke}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeDasharray={slot.dash}
                vectorEffect="non-scaling-stroke"
              />
            ));
          })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {mountpoints.map((mount, i) => (
          <div key={mount} className="flex items-center gap-1.5 min-w-0">
            <SeriesSwatch slot={SERIES_SLOTS[i % SERIES_SLOTS.length]} />
            <span className="microlabel truncate max-w-[9rem]" title={mount}>
              {mount}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const THIN_HISTORY_MS = 24 * 60 * 60 * 1000;

export function DiskGrowthPanel({ mountpoints }: { mountpoints: string[] }) {
  const [range, setRange] = useState<GrowthRange>("24h");
  const { shown: capped, dropped } = cappedMounts(mountpoints);
  const key =
    capped.length > 0 ? `/api/resources/growth?range=${range}&mounts=${encodeURIComponent(capped.join(","))}` : null;
  const { data, isLoading } = useSWR<MountGrowthResponse>(key, fetcher, {
    refreshInterval: 60000,
    keepPreviousData: true,
  });

  const isThin = !data || data.recordingSince == null || Date.now() - data.recordingSince < THIN_HISTORY_MS;

  // "Fastest growing": first-vs-last real sample per mount, only computed once
  // there's at least a day of real data (Threshold Rule — growth is a real
  // comparison against the mount's own earlier reading, not a vibe, and a
  // window shorter than a day is too noisy to call a trend honestly).
  const fastest = data && !isThin ? fastestGrowing(data.mounts) : null;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="microlabel">DISK GROWTH</div>
        <div className="panel p-1 flex gap-1 w-fit" role="group" aria-label="Growth range">
          {RANGES.map((r) => (
            <SegmentButton key={r.value} active={range === r.value} onClick={() => setRange(r.value)} label={r.label}>
              {r.label}
            </SegmentButton>
          ))}
        </div>
      </div>

      {capped.length === 0 ? (
        <div className="py-4 text-center text-ink-faint text-xs">no mounts to chart</div>
      ) : isThin ? (
        <div className="py-4 text-center">
          <p className="text-ink-dim text-xs">
            {!data || data.recordingSince == null
              ? "recording will start on the next telemetry tick — check back in about a minute"
              : `recording since ${relativeTime(data.recordingSince)} — growth needs at least a day of history to read honestly`}
          </p>
        </div>
      ) : isLoading && !data ? (
        <div className="py-4 text-center text-ink-faint text-xs">loading history…</div>
      ) : (
        <GrowthChart data={data!} mountpoints={capped} />
      )}

      {dropped > 0 && <div className="microlabel">{moreMountsNote(dropped)}</div>}

      {/* Neutral styling deliberately — growth is information, not an alarm
          (Threshold Rule: warn/bad are earned by a real capacity threshold,
          not by "this number went up"). */}
      {fastest && Math.abs(fastest.deltaBytes) > 0 && (
        <div className="microlabel">
          fastest growing: <span className="text-ink-dim">{fastest.mount}</span>{" "}
          {fastest.deltaBytes >= 0 ? "+" : ""}
          {formatBytes(fastest.deltaBytes)} over the window (~{formatBytes(Math.abs(fastest.deltaPerDay))}/day)
        </div>
      )}
    </div>
  );
}
