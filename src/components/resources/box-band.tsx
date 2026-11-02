"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkline } from "@/components/sparkline";
import {
  HistoryRangeControl,
  MetricHistoryPanel,
  type HistoryRangeOption,
  type MetricHistoryPanelProps,
} from "@/components/resources/resource-overview";
import { formatBytes, formatPercent } from "@/lib/format";
import { CPU_STEPS, MEM_STEPS, cpuBand, memBand } from "@/lib/watchlist";
import type { TelemetryRow, TelemetrySample } from "@/lib/client";

type BandHistory = Pick<
  MetricHistoryPanelProps,
  | "selectedContainers"
  | "slots"
  | "hostPoints"
  | "containerPoints"
  | "bucketTimes"
  | "recordingSince"
  | "isLoading"
>;

const SEG_FILL = ["bg-accent-dim", "bg-ink-faint", "bg-panel-2"] as const;
const LABEL_INK = ["text-bg", "text-bg", "text-ink-dim"] as const;
const LABEL_PX = 10; // 0.625rem
// Mono advance is about 0.6 em: the label width is computed, never read from the DOM per tick.
const labelWidth = (text: string) => text.length * 0.6 * LABEL_PX;

const compactBytes = (v: number) => v === 0 ? "0" : formatBytes(v, 0).replace(/ (.)iB$/, "$1");
const compactPct = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;

/**
 * The whole box on one band (CPU and MEM): containers, host & other and idle/free make up 100%.
 * Segments move with transform only (translate + scaleX as a percentage of the track), so a
 * 1 Hz tick changes text and transforms and never forces layout. The track width is observed
 * once per resize, not per tick.
 */
export function BoxBand({
  kind,
  host,
  containers,
  samples,
  range,
  onRangeChange,
  stale,
  history,
}: {
  kind: "cpu" | "mem";
  host: TelemetrySample["host"];
  containers: Record<string, TelemetryRow> | undefined;
  samples: TelemetrySample[];
  range: HistoryRangeOption;
  onRangeChange: (r: HistoryRangeOption) => void;
  stale: boolean;
  history: BandHistory;
}) {
  const isCpu = kind === "cpu";
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(600);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTrackW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = containers ? Object.values(containers) : [];
  const fmt = isCpu ? (v: number) => formatPercent(v, 1) : (v: number) => formatBytes(v);
  const names = ["containers", "host & other", isCpu ? "idle" : "free"] as const;
  const band = host
    ? isCpu
      ? cpuBand(host.cpuPct, rows.map((r) => r.cpuPct))
      : memBand(host.memUsed, host.memTotal, rows.map((r) => r.memBytes))
    : null;

  let figure = "reading host…";
  let aria = "Reading host";
  let figs: { label: string; value: string }[] = [];
  let sparkMax: number | undefined;
  const series = samples.map((s) => (isCpu ? (s.host?.cpuPct ?? 0) : (s.host?.memUsed ?? 0)));
  if (host && band) {
    const [c, o, f] = band.parts.map(fmt);
    if (isCpu) {
      figure = `${formatPercent(host.cpuPct, 1)} of ${host.cores} cores`;
      aria = `Box CPU ${formatPercent(host.cpuPct, 1)}: containers ${c}, host and other ${o}, idle ${f}`;
      const load = host.loadAvg ?? [];
      figs = [
        { label: "load 1m", value: load[0] != null ? load[0].toFixed(2) : "—" },
        { label: "load 5m", value: load[1] != null ? load[1].toFixed(2) : "—" },
        { label: "load 15m", value: load[2] != null ? load[2].toFixed(2) : "—" },
        { label: "temp", value: host.tempC != null ? `${host.tempC.toFixed(0)}°C` : "no sensor" },
      ];
      sparkMax = Math.max(5, ...series);
    } else {
      figure = `${formatBytes(host.memUsed)} of ${formatBytes(host.memTotal)}`;
      aria = `Box memory ${figure}: containers ${c}, host and other ${o}, free ${f}`;
      figs = [
        { label: "used", value: formatBytes(host.memUsed) },
        { label: "available", value: formatBytes(host.memAvailable) },
        { label: "containers", value: c },
        { label: "total", value: formatBytes(host.memTotal) },
      ];
      sparkMax = host.memTotal;
    }
  } else {
    figs = (isCpu ? ["load 1m", "load 5m", "load 15m", "temp"] : ["used", "available", "containers", "total"]).map((label) => ({ label, value: "—" }));
  }

  let start = 0;
  const segs = (band?.parts ?? [0, 0, 0]).map((v, i) => {
    const pct = band && band.base > 0 ? (v / band.base) * 100 : 0;
    const seg = { i, v, pct, start };
    start += pct;
    return seg;
  });

  return (
    <section className="panel p-4 flex flex-col gap-3 band" style={stale ? { opacity: 0.55 } : undefined} aria-label="The whole box">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="microlabel">THE BOX</span>
          <span className={host ? "font-mono text-lg text-ink" : "font-mono text-sm text-ink-dim"}>{figure}</span>
        </div>
        <div className="w-full md:w-auto">
          <HistoryRangeControl value={range} onChange={onRangeChange} />
        </div>
      </div>

      <div ref={trackRef} role="img" aria-label={aria} className="relative h-5 rounded-md overflow-hidden bg-panel-2">
        {segs.map(({ i, pct, start: x }) => (
          <div key={`s${i}`} className={`band-seg absolute inset-0 origin-left ${SEG_FILL[i]}`} style={{ transform: `translateX(${x}%) scaleX(${pct / 100})` }} />
        ))}
        {segs.slice(0, 2).map(({ i, pct, start: x }) => (
          <div key={`g${i}`} className="band-gap absolute inset-0 pointer-events-none" style={{ transform: `translateX(${x + pct}%)` }}>
            <span className="block h-full w-[2px] -ml-px bg-panel" />
          </div>
        ))}
        {band &&
          segs.map(({ i, v, pct, start: x }) => {
            const text = `${names[i]} ${fmt(v)}`;
            const fits = (pct / 100) * trackW > Math.max(trackW * 0.09, labelWidth(text) + 16);
            return (
              <div
                key={`l${i}`}
                aria-hidden
                className={`band-label absolute inset-0 pl-2 font-mono text-[0.625rem] leading-5 whitespace-nowrap pointer-events-none ${LABEL_INK[i]} ${i < 2 ? "font-semibold" : ""}`}
                style={{ transform: `translateX(${x}%)`, opacity: fits ? 1 : 0 }}
              >
                {text}
              </div>
            );
          })}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:flex md:flex-wrap">
        {names.map((name, i) => (
          <span key={name} className="inline-flex items-center gap-1.5 min-w-0 whitespace-nowrap">
            <i className={`w-2 h-2 rounded-sm shrink-0 border border-line-bright ${SEG_FILL[i]}`} />
            <span className="font-mono text-2xs text-ink-dim truncate">{`${name} ${band ? fmt(band.parts[i]) : "—"}`}</span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 border-t border-line md:grid-cols-[repeat(4,minmax(0,1fr))_160px]">
        {figs.map((f) => (
          <div key={f.label} className="min-w-0">
            <div className="microlabel truncate">{f.label}</div>
            <div className="font-mono text-sm text-ink mt-0.5 truncate">{f.value}</div>
          </div>
        ))}
        <div className="col-span-2 md:col-span-1 min-w-0">
          <div className="microlabel">60 s trend</div>
          {series.length > 0 && <Sparkline values={series} max={sparkMax} width={160} height={32} className="text-accent w-full md:w-40 mt-0.5" />}
        </div>
      </div>

      <MetricHistoryPanel
        range={range}
        {...history}
        formatValue={fmt}
        formatAxis={isCpu ? compactPct : compactBytes}
        steps={isCpu ? CPU_STEPS : MEM_STEPS}
      />
    </section>
  );
}
