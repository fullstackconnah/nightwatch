"use client";

/*
 * The Timeline view's chart (CPU and MEM): the box over the range as a stacked area, in the band's
 * chart slot. Shape brief: design-handoff/resources-timeline.md s3.2, s4, s5.
 *
 * Layers bottom up on ONE axis: the charted picks in slot order, rest of containers, host & other, then
 * the box line (slot 0). Calm-motion contract: the plot is measured on mount and resize only; a tick
 * changes SVG `d`, the slide group's translateX, the end labels' translateY and the tooltip text. The
 * path group is drawn against an anchor t0 and slides left by translateX (one reading per second at
 * LIVE); it re-anchors, with the transition off for that one render, once it has slid two windows.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeriesSwatch, type HistoryRangeOption } from "@/components/resources/resource-overview";
import { CPU_STEPS, snapScale } from "@/lib/watchlist";
import { SERIES_SLOTS, layoutEndLabels, type SeriesSlot } from "@/lib/chart-series";
import { RANGE_SHORT, RANGE_WORD, ringTail, stackLayers } from "@/lib/timeline";
import { formatBytes, formatPercent } from "@/lib/format";
import type { TelemetrySample } from "@/lib/client";

export interface HistoryBucket {
  t: number;
  cpuPct: number | null;
  memBytes: number | null;
}
/** /api/telemetry/history, with the optional `summary` fields. */
export interface TimelineHistory {
  recordingSince: number | null;
  host: HistoryBucket[];
  containers: Record<string, HistoryBucket[]>;
  containersTotal?: (number | null)[];
  summary?: Record<string, { avg: number; peak: number; spark: (number | null)[] }>;
}

const WINDOW_MS: Record<HistoryRangeOption, number> = { live: 60_000, "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 };
const TICKS: Record<HistoryRangeOption, [string, string]> = {
  live: ["−60 s", "−30 s"],
  "1h": ["−60 min", "−30 min"],
  "24h": ["−24 h", "−12 h"],
  "7d": ["−7 d", "−3.5 d"],
};
const END_GAP = 14;
const TIP_W = 196;
const KEY_SLOTS = 7; // box, host & other, rest, up to 4 picks: reserved at mount so the chart box never reflows
const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const compactBytes = (v: number) => (v === 0 ? "0" : formatBytes(v, 0).replace(/ (.)iB$/, "$1"));

interface Model {
  times: number[];
  host: (number | null)[];
  total: (number | null)[];
  /** In slot order. */
  picks: { name: string; slot: SeriesSlot; points: (number | null)[] }[];
  since: number | null;
}

function buildModel(
  kind: "cpu" | "mem",
  range: HistoryRangeOption,
  samples: TelemetrySample[],
  idOf: (name: string) => string | undefined,
  chartIds: string[],
  slots: ReadonlyMap<string, number>,
  series: TimelineHistory | undefined,
  summary: TimelineHistory | undefined,
): Model {
  const cpu = kind === "cpu";
  const pick = (b: HistoryBucket) => (cpu ? b.cpuPct : b.memBytes);
  const ordered = chartIds
    .map((name) => ({ name, n: slots.get(name) ?? 1 }))
    .sort((a, b) => a.n - b.n)
    .map(({ name, n }) => ({ name, slot: SERIES_SLOTS[n] }));
  const rowVal = (s: TelemetrySample, id: string | undefined) => {
    const r = id ? s.containers[id] : undefined;
    return r ? (cpu ? r.cpuPct : r.memBytes) : null;
  };
  const ringOf = (f: (s: TelemetrySample) => number | null) =>
    samples.flatMap((s) => {
      const v = f(s);
      return v == null ? [] : [{ ts: s.ts, v }];
    });
  const ringHost = ringOf((s) => (s.host ? (cpu ? s.host.cpuPct : s.host.memUsed) : null));

  if (range === "live") {
    return {
      times: samples.map((s) => s.ts),
      host: samples.map((s) => (s.host ? (cpu ? s.host.cpuPct : s.host.memUsed) : null)),
      total: samples.map((s) => Object.values(s.containers).reduce((a, r) => a + (cpu ? r.cpuPct : r.memBytes), 0)),
      picks: ordered.map((o) => ({ ...o, points: samples.map((s) => rowVal(s, idOf(o.name))) })),
      since: null,
    };
  }
  // The summary response owns host and containersTotal (aligned by index); the series response owns the
  // named picks, joined by bucket time because the two requests are made at different instants.
  const base = summary ?? series;
  if (!base) return { times: [], host: [], total: [], picks: ordered.map((o) => ({ ...o, points: [] })), since: null };
  const times = base.host.map((b) => b.t);
  let host = base.host.map(pick);
  let total: (number | null)[] = base.containersTotal ?? times.map(() => null);
  let picks = ordered.map((o) => {
    const byT = new Map((series?.containers[o.name] ?? []).map((b) => [b.t, pick(b)] as const));
    return { ...o, points: times.map((t) => byT.get(t) ?? null) };
  });
  if (range === "1h" && times.length > 1) {
    const w = times[1] - times[0];
    host = ringTail(host, times, ringHost, w, "1h");
    total = ringTail(total, times, ringOf((s) => Object.values(s.containers).reduce((a, r) => a + (cpu ? r.cpuPct : r.memBytes), 0)), w, "1h");
    picks = picks.map((p) => ({ ...p, points: ringTail(p.points, times, ringOf((s) => rowVal(s, idOf(p.name))), w, "1h") }));
  }
  return { times, host, total, picks, since: base.recordingSince };
}

export interface TimelineChartProps {
  kind: "cpu" | "mem";
  range: HistoryRangeOption;
  samples: TelemetrySample[];
  containers: { id: string; name: string }[];
  chartIds: string[];
  slots: ReadonlyMap<string, number>;
  series: TimelineHistory | undefined;
  summary: TimelineHistory | undefined;
  loading: boolean;
  /** Set when the history fetch failed (status text). */
  error: string | null;
  onRetry: () => void;
  stale: boolean;
  memTotal: number | undefined;
  /** The owner has picked containers: the mode line offers Top 4. */
  picked: boolean;
  onTop4: () => void;
}

export function TimelineChart(p: TimelineChartProps) {
  const { kind, range, stale } = p;
  const cpu = kind === "cpu";
  const fmt = (v: number) => (cpu ? formatPercent(v, v < 0.1 ? 2 : 1) : formatBytes(v));
  const uid = useId().replace(/:/g, "");

  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 200 });
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(1, Math.round(e.contentRect.width)), h: Math.max(1, Math.round(e.contentRect.height)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w: W, h: H } = size;

  const idOf = useMemo(() => {
    const m = new Map(p.containers.map((c) => [c.name, c.id]));
    return (name: string) => m.get(name);
  }, [p.containers]);
  const model = useMemo(
    () => buildModel(kind, range, p.samples, idOf, p.chartIds, p.slots, p.series, p.summary),
    [kind, range, p.samples, idOf, p.chartIds, p.slots, p.series, p.summary],
  );
  const st = useMemo(
    () => stackLayers({ host: model.host, containersTotal: model.total, picks: model.picks.map((x) => x.points) }),
    [model],
  );

  // OPEN-T1 (owner delegated): the CPU axis snaps to the house step above the window's box peak, from 0;
  // MEM keeps 0-memTotal.
  const boxPeak = st.top.reduce((m, v, i) => (st.gap[i] ? m : Math.max(m, v)), 0);
  const axisMax = cpu ? snapScale(boxPeak, CPU_STEPS) : Math.max(1, p.memTotal ?? 1);

  const n = model.times.length;
  const winMs = WINDOW_MS[range];
  const tEnd = n ? model.times[n - 1] : 0;
  const anchor = useRef<{ range: string; t0: number } | null>(null);
  let reanchor = false;
  if (n && (!anchor.current || anchor.current.range !== range || tEnd - anchor.current.t0 > 2 * winMs || tEnd < anchor.current.t0)) {
    anchor.current = { range, t0: tEnd };
    reanchor = true;
  }
  const t0 = anchor.current?.t0 ?? 0;
  const k = W / winMs;
  const X = (t: number) => (t - t0) * k;
  const Y = (v: number) => H - 1 - Math.min(1, Math.max(0, v) / axisMax) * (H - 2);
  const slide = W - (tEnd - t0) * k;

  const areaD = (lay: [number, number][]) => {
    let d = "";
    let run: number[] = [];
    const flush = () => {
      if (run.length > 1) {
        d += `M${run.map((i) => `${X(model.times[i]).toFixed(1)} ${Y(lay[i][1]).toFixed(1)}`).join("L")}L${run
          .slice()
          .reverse()
          .map((i) => `${X(model.times[i]).toFixed(1)} ${Y(lay[i][0]).toFixed(1)}`)
          .join("L")}Z`;
      }
      run = [];
    };
    for (let i = 0; i < n; i++) (st.gap[i] ? flush() : run.push(i));
    flush();
    return d;
  };
  const lineD = (vals: number[]) => {
    let d = "";
    let pen = false;
    for (let i = 0; i < n; i++) {
      if (st.gap[i]) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${X(model.times[i]).toFixed(1)} ${Y(vals[i]).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  // The latest bucket that is not a gap: the live dot, the end labels, the figures.
  let li = n - 1;
  while (li >= 0 && st.gap[li]) li--;
  const size1 = (b: [number, number][]) => (li >= 0 ? b[li][1] - b[li][0] : 0);
  const mid = (b: [number, number][]) => (li >= 0 ? (b[li][0] + b[li][1]) / 2 : 0);
  const hostNow = li >= 0 ? (model.host[li] ?? 0) : 0;
  const hosts = model.host.filter((v): v is number => v != null);
  const hostAvg = hosts.length ? hosts.reduce((a, v) => a + v, 0) / hosts.length : 0;

  const items: { key: string; name: string; value: number; y: number; slot?: SeriesSlot; chip?: "rest" | "other" }[] = li < 0 ? [] : [
    { key: "box", name: "box", value: hostNow, y: st.top[li], slot: SERIES_SLOTS[0] },
    { key: "other", name: "host & other", value: size1(st.other), y: mid(st.other), chip: "other" },
    { key: "rest", name: "rest of containers", value: size1(st.rest), y: mid(st.rest), chip: "rest" },
    ...model.picks.map((pk, j) => ({ key: `p${j}`, name: pk.name, value: size1(st.picks[j]), y: mid(st.picks[j]), slot: pk.slot })),
  ];
  const y0 = items.map((it) => Y(it.y));
  const yL = layoutEndLabels(y0, H, END_GAP);

  // Hatch: the part of the window before recording began is a gap, never a zero.
  const tStart = tEnd - winMs;
  const nothing = range !== "live" && n > 0 && model.since == null;
  const hatchW = nothing ? winMs * k : model.since != null && n && model.since > tStart ? Math.min(winMs, model.since - tStart) * k : 0;

  let hint: string;
  if (p.error) hint = "The box line is live; history is unavailable.";
  else if (range === "live") hint = "The last 60 s, one reading per second.";
  else if (p.loading && !n) hint = "Loading history…";
  else if (nothing) hint = "Nothing recorded yet: history fills every 30 s. LIVE shows the last 60 s.";
  else if (model.since != null && model.since > tStart) hint = `Recording since ${utc(model.since)} UTC: the hatched start of this window has no data yet (a gap, not zero).`;
  else if (range === "1h") hint = "The right edge is live: it moves with every reading.";
  else hint = "The right edge updates every 30 s.";

  const [tipX, setTipX] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent) => setTipX(e.clientX - e.currentTarget.getBoundingClientRect().left);
  let tip: React.ReactNode = null;
  let crossX = 0;
  if (tipX != null && n) {
    const t = tEnd - (1 - tipX / W) * winMs;
    let i = 0;
    for (let j = 1; j < n; j++) if (Math.abs(model.times[j] - t) < Math.abs(model.times[i] - t)) i = j;
    crossX = W - ((tEnd - model.times[i]) / winMs) * W;
    const ago = tEnd - model.times[i];
    const when = ago < 1000 ? "now" : ago < 120_000 ? `${Math.round(ago / 1000)} s ago` : ago < 7_200_000 ? `${Math.round(ago / 60_000)} min ago` : `${utc(model.times[i])} UTC`;
    const sz = (b: [number, number]) => fmt(b[1] - b[0]);
    const left = crossX + 12 + TIP_W > W ? crossX - 12 - TIP_W : crossX + 12;
    tip = (
      <div className="tl-tip" style={{ transform: `translateX(${Math.max(0, left).toFixed(1)}px)`, width: TIP_W }}>
        <div className="tl-tiphead">{when}</div>
        {st.gap[i] ? (
          <div className="tl-tiprow">not recorded (gap)</div>
        ) : (
          <>
            <div className="tl-tiprow"><SeriesSwatch slot={SERIES_SLOTS[0]} /><span className="tl-tipname">box</span><span>{fmt(model.host[i] ?? 0)}</span></div>
            <div className="tl-tiprow"><i className="tl-chip tl-chip-other" /><span className="tl-tipname">host & other</span><span>{sz(st.other[i])}</span></div>
            <div className="tl-tiprow"><i className="tl-chip tl-chip-rest" /><span className="tl-tipname">rest of containers</span><span>{sz(st.rest[i])}</span></div>
            {model.picks.map((pk, j) => (
              <div className="tl-tiprow" key={pk.name}>
                <SeriesSwatch slot={pk.slot} />
                <span className="tl-tipname">{pk.name}</span>
                <span>{pk.points[i] == null ? "no data" : sz(st.picks[j][i])}</span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  const showPlot = n > 0 && !p.error;
  const at = li >= 0 && range !== "live" ? utc(model.times[li]).slice(11) : null; // the end labels read this bucket, the band reads the live sample
  const aria = li >= 0 ? `box ${fmt(hostNow)} now, ${fmt(hostAvg)} on average over the ${RANGE_WORD[range]}` : "Box history, no readings yet";
  const sub = li >= 0 ? `containers ${fmt(size1(st.rest) + st.picks.reduce((a, b) => a + (b[li][1] - b[li][0]), 0))} of it · ${RANGE_SHORT[range]} avg ${fmt(hostAvg)}` : "reading host…";
  const mode = p.picked
    ? `Your picks · ${p.chartIds.length} of 4. Tick a strip to add or remove it.`
    : `Top 4 by ${RANGE_SHORT[range]} average. Tick a strip to pick your own.`;

  return (
    <div className="tl-hero space-y-3" data-stale={stale || undefined}>
      <p className="tl-sub font-mono text-2xs text-ink-dim m-0">
        {sub}
        {at && <span className="md:hidden">{` · at ${at} UTC`}</span>}
      </p>
      <div className="tl-chart">
        <div aria-hidden className="tl-axis">
          <span>{cpu ? formatPercent(axisMax, 0) : compactBytes(axisMax)}</span>
          <span>{cpu ? formatPercent(axisMax / 2, Number.isInteger(axisMax / 2) ? 0 : 1) : compactBytes(axisMax / 2)}</span>
          <span>{cpu ? "0%" : "0"}</span>
        </div>
        <div className="tl-plotcol">
          <div
            ref={plotRef}
            role="img"
            aria-label={aria}
            className={showPlot || p.error ? "tl-plot" : "tl-plot tl-plot-skel motion-safe:animate-pulse"}
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setTipX(null)}
          >
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden className="block">
              <defs>
                <pattern id={`tl-hatch-${uid}`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={2} height={6} className="tl-hatchline" />
                </pattern>
              </defs>
              {[0.5, 1].map((f) => (
                <line key={f} x1={0} x2={W} y1={Y(axisMax * f)} y2={Y(axisMax * f)} className="tl-grid" />
              ))}
              {p.error && <rect x={0} y={0} width={W} height={H} fill={`url(#tl-hatch-${uid})`} />}
              {showPlot && (
                <g className={reanchor ? "tl-slide tl-noslide" : "tl-slide"} style={{ transform: `translateX(${slide.toFixed(2)}px)` }}>
                  {hatchW > 0 && <rect x={X(tStart)} y={0} width={hatchW} height={H} fill={`url(#tl-hatch-${uid})`} />}
                  <path d={areaD(st.other)} className="tl-area-other" />
                  <path d={areaD(st.rest)} className="tl-area-rest" />
                  {model.picks.map((pk, j) => (
                    <path key={pk.name} d={areaD(st.picks[j])} style={{ fill: pk.slot.stroke }} className="tl-area-pick" />
                  ))}
                  <path d={lineD(st.rest.map((b) => b[1]))} className="tl-edge-rest" />
                  {model.picks.map((pk, j) => (
                    <path key={pk.name} d={lineD(st.picks[j].map((b) => b[1]))} className="tl-edge-pick" style={{ stroke: pk.slot.stroke }} strokeDasharray={pk.slot.dash} />
                  ))}
                  <path d={lineD(st.top)} className="tl-box" />
                  {li >= 0 && (
                    <>
                      <circle cx={X(model.times[li])} cy={Y(st.top[li])} r={6} className="tl-halo" />
                      <circle cx={X(model.times[li])} cy={Y(st.top[li])} r={3} className="tl-dot" />
                    </>
                  )}
                </g>
              )}
              <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="tl-base" />
            </svg>
            {p.error && (
              <div className="tl-err">
                <p className="m-0 text-sm font-semibold text-ink">History did not load</p>
                <p className="m-0 text-2xs text-ink-dim font-mono">{`GET /api/telemetry/history → ${p.error}. Retrying every 30 s.`}</p>
                <Button size="sm" variant="outline" className="md:h-8" onClick={p.onRetry}>
                  <RotateCw size={12} aria-hidden /> Retry now
                </Button>
              </div>
            )}
            {tip && <div className="tl-cross" style={{ transform: `translateX(${crossX.toFixed(1)}px)` }} />}
            {tip}
          </div>
          <div aria-hidden className="tl-times">
            <span>{TICKS[range][0]}</span>
            <span>{TICKS[range][1]}</span>
            <span>now</span>
          </div>
        </div>
        <div aria-hidden className="tl-ends">
          {at && <span className="tl-bucket">{`at ${at} UTC`}</span>}
          <svg className="tl-leaders" width={14} height={H} viewBox={`0 0 14 ${H}`}>
            {items.map((it, i) => (
              <path key={it.key} d={`M0 ${y0[i].toFixed(1)}L8 ${yL[i].toFixed(1)}L12 ${yL[i].toFixed(1)}`} className="tl-leader" />
            ))}
          </svg>
          {items.map((it, i) => (
            <div key={it.key} className="tl-end" style={{ transform: `translateY(${(yL[i] - 7).toFixed(1)}px)` }}>
              {it.slot ? <SeriesSwatch slot={it.slot} /> : <i className={`tl-chip tl-chip-${it.chip}`} />}
              <span className="tl-endname" title={it.name}>{it.name}</span>
              <span className="tl-endval">{fmt(it.value)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tl-key">
        {Array.from({ length: KEY_SLOTS }, (_, i) => {
          const it = items[i];
          return (
            <span key={i} className="tl-keyitem" style={{ visibility: it ? "visible" : "hidden" }}>
              {it && (it.slot ? <SeriesSwatch slot={it.slot} /> : <i className={`tl-chip tl-chip-${it.chip}`} />)}
              <span className="tl-endname">{it?.name}</span>
              <span className="tl-endval">{it ? fmt(it.value) : ""}</span>
            </span>
          );
        })}
      </div>
      <div className="tl-modeline">
        <span className="text-2xs text-ink-dim">{mode}</span>
        {p.picked && (
          <Button size="sm" variant="ghost" className="tl-top4 md:h-8" onClick={p.onTop4}>
            Top 4
          </Button>
        )}
      </div>
      <p className="tl-hint text-2xs text-ink-dim min-h-[1.05rem] m-0">{hint}</p>
    </div>
  );
}
