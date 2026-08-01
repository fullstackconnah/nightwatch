/* THESIS: one glance answers "what is eating this box" — proportion first, numbers second; refuses the category default of a stats table with a chart bolted on.
   OWN-WORLD: nightwatch homelab console — near-black #070b11, .panel hairlines, teal accent as the single data hue, mono numerals, 10px microlabels; magnitude = bar length / cell area, never rainbow.
   STORY: the owner taps CPU/MEM/DISK, sees the top consumer instantly, taps a row for that container's live detail + widget data + actions.
   FIRST VIEWPORT: totals strip, CPU/MEM/DISK segmented toggle, squarified treemap hero (~38vh), ranked bar list beginning beneath — top consumer visible without scrolling.
   FORM: interactive treemap + ranked proportional bars, per user selection; drill-in = inline row expansion.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
"use client";

import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronDown, ExternalLink, Play, RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentButton } from "@/components/ui/segment-button";
import { Meter } from "@/components/charts";
import { Sparkline } from "@/components/sparkline";
import { Treemap, type TreemapItem } from "@/components/treemap";
import {
  ResourceOverview,
  MetricHistoryPanel,
  type OverviewModel,
  type HistoryRangeOption,
} from "@/components/resource-overview";
import { GpuView } from "@/components/gpu-view";
import { ProcessTable } from "@/components/process-table";
import { DriveHealthPanel } from "@/components/drive-health";
import { DiskContentsPanel } from "@/components/disk-contents";
import { PinnedFoldersPanel } from "@/components/disk-pinned";
import { DiskGrowthPanel } from "@/components/disk-growth";
import { cn } from "@/lib/utils";
import { formatBytes, formatPercent, formatRate, relativeTime } from "@/lib/format";
import {
  fetcher,
  postJson,
  useResources,
  useTelemetryStream,
  useWidgets,
  seriesFor,
  type ResourceSnapshot,
  type TelemetryRow,
  type TelemetrySample,
} from "@/lib/client";

// Local mirror of metrics-history.ts's wire shape rather than an import — that
// module reads node:fs and must never enter this "use client" page's bundle,
// the same reasoning telemetry-types.ts documents for its own zero-import rule.
interface HistoryBucketDto {
  t: number;
  cpuPct: number | null;
  memBytes: number | null;
}
interface HistoryApiResponse {
  recordingSince: number | null;
  host: HistoryBucketDto[];
  containers: Record<string, HistoryBucketDto[]>;
}

type Metric = "all" | "cpu" | "mem" | "disk" | "net" | "gpu" | "blkio";

const ALL_METRICS: readonly Metric[] = ["all", "cpu", "mem", "disk", "net", "gpu", "blkio"];

/** Tab order: broad first, then the triage sequence you actually walk (CPU is what
 *  you check, then memory, then disk, then network), with GPU last as the
 *  specialist view. "blkio" is not a tab — it is DISK's sub-view. */
const TAB_METRICS: readonly Metric[] = ["all", "cpu", "mem", "disk", "net", "gpu"];

/** Short enough that six tabs fit a 360px phone without scrolling or wrapping, and
 *  already this app's own idiom — the totals strip above says CPU and MEM too.
 *  ACCESSIBLE_METRIC_LABELS carries the unabbreviated name for screen readers. */
const METRIC_LABELS: Record<Metric, string> = {
  all: "ALL",
  cpu: "CPU",
  mem: "MEM",
  disk: "DISK",
  net: "NET",
  gpu: "GPU",
  blkio: "DISK I/O",
};

const ACCESSIBLE_METRIC_LABELS: Record<Metric, string> = {
  all: "All processes",
  cpu: "CPU",
  mem: "Memory",
  disk: "Disk",
  net: "Network",
  gpu: "GPU",
  blkio: "Disk I/O",
};

function isMetric(v: string | null): v is Metric {
  return v !== null && (ALL_METRICS as readonly string[]).includes(v);
}

type ResourceContainer = ResourceSnapshot["containers"][number];
type HostDisk = NonNullable<ResourceSnapshot["hostDisks"]>[number];
type DiskSegment = { key: string; label: string; value: number; fill: string };

/** Path-segment-aware prefix test: "/mnt/docker" matches "/mnt/docker/docker-data" but not "/mnt/dockerfoo". "/" matches everything. */
function isMountPrefixOf(mount: string, path: string): boolean {
  if (mount === "/") return true;
  return path === mount || path.startsWith(mount.endsWith("/") ? mount : `${mount}/`);
}

function otherDiskSegments(d: HostDisk): DiskSegment[] {
  const segs: DiskSegment[] = [];
  if (d.used > 0) segs.push({ key: "used", label: "used", value: d.used, fill: "#0f766e" });
  const free = Math.max(0, d.total - d.used);
  segs.push({ key: "free", label: "free", value: free, fill: "var(--color-panel-2)" });
  return segs;
}

const isDockerSegKey = (k: string) => k === "images" || k === "writable" || k === "volumes" || k === "buildcache";

const SEGMENT_LEGEND: DiskSegment[] = [
  { key: "images", label: "images", value: 0, fill: "#134e4a" },
  { key: "writable", label: "writable layers", value: 0, fill: "#0f766e" },
  { key: "volumes", label: "volumes", value: 0, fill: "#0d9488" },
  { key: "buildcache", label: "build cache", value: 0, fill: "#14b8a6" },
  { key: "other", label: "other used", value: 0, fill: "var(--color-line-bright)" },
  { key: "used", label: "used", value: 0, fill: "#0f766e" },
  { key: "free", label: "free", value: 0, fill: "var(--color-panel-2)" },
];

function valueOf(c: ResourceContainer, metric: Metric, row: TelemetryRow | undefined): number | null {
  // ALL ranks host PROCESSES, not containers — ProcessTable owns that list and does
  // its own sorting, so there is no container magnitude to report here.
  if (metric === "all") return null;
  if (metric === "cpu") return row?.cpuPct ?? c.cpuPct;
  if (metric === "mem") return row?.memBytes ?? c.memBytes;
  if (metric === "net") return row ? row.rxRate + row.txRate : null;
  if (metric === "blkio") return row ? row.blkReadRate + row.blkWriteRate : null;
  return c.sizeRootFs;
}

function formatValue(metric: Metric, v: number): string {
  if (metric === "cpu") return formatPercent(v, 1);
  if (metric === "net" || metric === "blkio") return formatRate(v);
  return formatBytes(v);
}

type OverviewHost = NonNullable<TelemetrySample["host"]>;

// Reused from the existing HOST DISK segment palette (dockerSegments / otherDiskSegments)
// rather than inventing new hues — these are the fills already proven legible at
// text-[0.625rem] inline segment-label size.
const OVERVIEW_FILL_PRIMARY = "#0f766e"; // "writable"/"used" teal
const OVERVIEW_FILL_SECONDARY = "#0d9488"; // "volumes" teal
const OVERVIEW_FILL_OTHER = "var(--color-line-bright)"; // "other used" slate
const OVERVIEW_FILL_TRACK = "var(--color-panel-2)"; // "free" track treatment

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function emptyOverview(): OverviewModel {
  return { scale: 0, segments: [], headline: "—", caption: "", figures: [] };
}

function buildCpuOverview(
  host: OverviewHost | undefined,
  samples: TelemetrySample[],
  containers: Record<string, TelemetryRow> | undefined,
): OverviewModel {
  if (!host) return emptyOverview();
  // 60s trend, same idiom buildNetOverview/buildBlkioOverview already use — CPU
  // and MEM previously lacked this `series`, the one asymmetry this closes; the
  // LIVE range of the new history panel below is exactly this ring, unmodified.
  const series = samples.map((s) => Math.max(0, finite(s.host?.cpuPct ?? 0)));
  const rows = containers ? Object.values(containers) : [];
  // row.cpuPct is Docker-style (one busy core = 100, so a 16-core box can sum to 1600);
  // host.cpuPct is already 0-100 for the whole box. Dividing by cores puts them in the
  // same units — without it the bar is nonsense.
  const containerPct = Math.max(0, finite(rows.reduce((a, r) => a + r.cpuPct, 0) / Math.max(1, host.cores)));
  const hostPct = Math.max(0, finite(host.cpuPct));
  const containersSeg = Math.max(0, Math.min(containerPct, hostPct));
  const otherSeg = Math.max(0, hostPct - containerPct);
  const idleSeg = Math.max(0, 100 - hostPct);

  const load = host.loadAvg ?? [];
  const figures: { label: string; value: string }[] = [
    { label: "load 1m", value: load[0] != null ? load[0].toFixed(2) : "—" },
    { label: "load 5m", value: load[1] != null ? load[1].toFixed(2) : "—" },
    { label: "load 15m", value: load[2] != null ? load[2].toFixed(2) : "—" },
  ];
  if (host.tempC != null) figures.push({ label: "temp", value: `${host.tempC.toFixed(0)}°C` });

  return {
    scale: 100,
    segments: [
      { key: "containers", label: "containers", value: containersSeg, fill: OVERVIEW_FILL_PRIMARY, display: formatPercent(containersSeg, 1) },
      { key: "other", label: "other", value: otherSeg, fill: OVERVIEW_FILL_OTHER, display: formatPercent(otherSeg, 1) },
      { key: "idle", label: "idle", value: idleSeg, fill: OVERVIEW_FILL_TRACK, display: formatPercent(idleSeg, 1) },
    ],
    headline: `${formatPercent(hostPct, 0)} of ${host.cores} cores`,
    caption: `containers ${formatPercent(containersSeg, 1)} · other ${formatPercent(otherSeg, 1)}`,
    figures,
    series,
  };
}

function buildMemOverview(
  host: OverviewHost | undefined,
  samples: TelemetrySample[],
  containers: Record<string, TelemetryRow> | undefined,
): OverviewModel {
  if (!host) return emptyOverview();
  const series = samples.map((s) => Math.max(0, finite(s.host?.memUsed ?? 0)));
  const rows = containers ? Object.values(containers) : [];
  const containerBytes = Math.max(0, finite(rows.reduce((a, r) => a + r.memBytes, 0)));
  const memUsed = Math.max(0, finite(host.memUsed));
  const memTotal = Math.max(0, finite(host.memTotal));
  const memAvailable = Math.max(0, finite(host.memAvailable));
  const containersSeg = Math.max(0, Math.min(containerBytes, memUsed));
  const otherSeg = Math.max(0, memUsed - containerBytes);

  return {
    scale: memTotal,
    segments: [
      { key: "containers", label: "containers", value: containersSeg, fill: OVERVIEW_FILL_PRIMARY, display: formatBytes(containersSeg) },
      { key: "other", label: "other", value: otherSeg, fill: OVERVIEW_FILL_OTHER, display: formatBytes(otherSeg) },
      { key: "available", label: "available", value: memAvailable, fill: OVERVIEW_FILL_TRACK, display: formatBytes(memAvailable) },
    ],
    headline: `${formatBytes(memUsed)} / ${formatBytes(memTotal)}`,
    caption: "",
    figures: [
      { label: "used", value: formatBytes(memUsed) },
      { label: "containers", value: formatBytes(containersSeg) },
      { label: "other", value: formatBytes(otherSeg) },
      { label: "available", value: formatBytes(memAvailable) },
    ],
    series,
  };
}

function buildNetOverview(
  host: OverviewHost | undefined,
  samples: TelemetrySample[],
  containers: Record<string, TelemetryRow> | undefined,
): OverviewModel {
  if (!host) return emptyOverview();
  // Peak is the max of the per-sample host total across the whole ring, not the
  // current value — the bar has no hardware ceiling, so the ring peak is the scale.
  let peak = 0;
  const series: number[] = [];
  for (const s of samples) {
    const total = Math.max(0, s.host ? finite(s.host.rxRate) + finite(s.host.txRate) : 0);
    series.push(total);
    if (total > peak) peak = total;
  }

  const rx = Math.max(0, finite(host.rxRate));
  const tx = Math.max(0, finite(host.txRate));
  const rows = containers ? Object.values(containers) : [];
  const containersTotal = Math.max(0, finite(rows.reduce((a, r) => a + r.rxRate + r.txRate, 0)));

  return {
    scale: peak,
    segments: [
      { key: "rx", label: "rx", value: rx, fill: OVERVIEW_FILL_PRIMARY, display: formatRate(rx) },
      { key: "tx", label: "tx", value: tx, fill: OVERVIEW_FILL_SECONDARY, display: formatRate(tx) },
    ],
    headline: formatRate(rx + tx),
    caption: `peak ${formatRate(peak)} · 60s window`,
    figures: [
      { label: "rx", value: formatRate(rx) },
      { label: "tx", value: formatRate(tx) },
      { label: "containers", value: formatRate(containersTotal) },
      { label: "peak", value: formatRate(peak) },
    ],
    series,
  };
}

function buildBlkioOverview(
  host: OverviewHost | undefined,
  samples: TelemetrySample[],
  containers: Record<string, TelemetryRow> | undefined,
): OverviewModel {
  if (!host) return emptyOverview();
  // null explicitly means /proc/diskstats was unreadable, NOT zero — fall back to
  // container sums for both the segments and the series rather than rendering a
  // measured-looking 0.
  const hostUnavailable = host.diskReadRate === null;
  const rows = containers ? Object.values(containers) : [];
  const containerRead = Math.max(0, finite(rows.reduce((a, r) => a + r.blkReadRate, 0)));
  const containerWrite = Math.max(0, finite(rows.reduce((a, r) => a + r.blkWriteRate, 0)));

  const read = host.diskReadRate === null ? containerRead : Math.max(0, finite(host.diskReadRate));
  const write = host.diskReadRate === null ? containerWrite : Math.max(0, finite(host.diskWriteRate ?? 0));

  let peak = 0;
  const series: number[] = [];
  for (const s of samples) {
    let total: number;
    if (hostUnavailable) {
      const crows = s.containers ? Object.values(s.containers) : [];
      total = crows.reduce((a, r) => a + finite(r.blkReadRate) + finite(r.blkWriteRate), 0);
    } else {
      total = s.host && s.host.diskReadRate !== null && s.host.diskWriteRate !== null
        ? finite(s.host.diskReadRate) + finite(s.host.diskWriteRate)
        : 0;
    }
    total = Math.max(0, total);
    series.push(total);
    if (total > peak) peak = total;
  }

  return {
    scale: peak,
    segments: [
      { key: "read", label: "read", value: read, fill: OVERVIEW_FILL_PRIMARY, display: formatRate(read) },
      { key: "write", label: "write", value: write, fill: OVERVIEW_FILL_SECONDARY, display: formatRate(write) },
    ],
    headline: formatRate(read + write),
    caption: `peak ${formatRate(peak)} · 60s window`,
    figures: [
      { label: "read", value: formatRate(read) },
      { label: "write", value: formatRate(write) },
      { label: "peak", value: formatRate(peak) },
    ],
    series,
    caveat: hostUnavailable ? "host disk I/O unavailable — container totals only" : undefined,
  };
}

function buildOverviewModel(
  metric: Metric,
  host: OverviewHost | undefined,
  samples: TelemetrySample[],
  containers: Record<string, TelemetryRow> | undefined,
): OverviewModel {
  switch (metric) {
    case "cpu":
      return buildCpuOverview(host, samples, containers);
    case "mem":
      return buildMemOverview(host, samples, containers);
    case "net":
      return buildNetOverview(host, samples, containers);
    case "blkio":
      return buildBlkioOverview(host, samples, containers);
    case "disk":
      return emptyOverview();
    // GpuView owns its own VRAM overview band; this metric never reaches
    // ResourceOverview (see gpuActive in ResourcesPage), so there is nothing to build.
    case "gpu":
      return emptyOverview();
    // ALL is a process table, not a container magnitude — it is suppressed before
    // ResourceOverview renders (see allActive). Present only for exhaustiveness.
    case "all":
      return emptyOverview();
  }
}

function ContainerActions({
  id,
  running,
  onDone,
}: {
  id: string;
  running: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function act(action: "start" | "stop" | "restart") {
    setBusy(action);
    try {
      await postJson(`/api/docker/containers/${id.slice(0, 12)}/action`, { action });
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex items-center gap-1.5">
      {running ? (
        <>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("restart")}>
            <RotateCw size={12} className={busy === "restart" ? "animate-spin" : ""} /> Restart
          </Button>
          <Button size="sm" variant="danger" disabled={!!busy} onClick={() => act("stop")}>
            <Square size={12} /> Stop
          </Button>
        </>
      ) : (
        <Button size="sm" disabled={!!busy} onClick={() => act("start")}>
          <Play size={12} /> Start
        </Button>
      )}
    </div>
  );
}

function ContainerRow({
  c,
  metric,
  max,
  row,
  samples,
  expanded,
  onToggle,
  widgetFields,
  onActionDone,
  rowRef,
}: {
  c: ResourceContainer;
  metric: Metric;
  max: number;
  row: TelemetryRow | undefined;
  samples: TelemetrySample[];
  expanded: boolean;
  onToggle: () => void;
  widgetFields: { label: string; value: string; intent?: "ok" | "warn" | "bad" }[] | undefined;
  onActionDone: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const v = valueOf(c, metric, row);
  const hasValue = v != null && v > 0;
  const pct = hasValue ? Math.min(100, ((v as number) / max) * 100) : 0;
  const running = c.state === "running";
  const memPct = c.memLimit > 0 ? (c.memBytes / c.memLimit) * 100 : 0;

  return (
    <div ref={rowRef} className="border-b border-line/50 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        title={`${c.name}: ${hasValue ? formatValue(metric, v as number) : "no data"}`}
        className="w-full flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2.5 min-h-11 md:min-h-8 px-3 py-1.5 text-left cursor-pointer hover:bg-panel-2/60"
      >
        <div className="flex items-center gap-2.5 w-full">
          <span className={cn("dot", running ? "dot-running" : "dot-stopped")} />
          <span className="font-mono text-[0.8rem] truncate flex-1 min-w-0">{c.name}</span>
          <div className="hidden sm:block w-32 md:w-40 h-1.5 rounded-full bg-panel-2 overflow-hidden">
            {hasValue && (
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-accent-dim)" }} />
            )}
          </div>
          <span className="font-mono text-[0.75rem] text-ink w-20 text-right">
            {hasValue ? formatValue(metric, v as number) : "—"}
          </span>
          <ChevronDown
            size={13}
            className={cn("text-ink-faint transition-transform shrink-0", expanded && "rotate-180")}
          />
        </div>
        <div className="sm:hidden w-full h-0.5 rounded-full bg-panel-2 overflow-hidden">
          {hasValue && (
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-accent-dim)" }} />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 bg-panel-2/30">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="microlabel mb-1">CPU</div>
              <div className="font-mono text-ink">{formatPercent(c.cpuPct, 1)}</div>
            </div>
            <div>
              <div className="microlabel mb-1">Memory</div>
              <div className="font-mono text-ink mb-1">
                {formatBytes(c.memBytes)} {c.memLimit > 0 ? `/ ${formatBytes(c.memLimit)}` : ""}
              </div>
              {c.memLimit > 0 && <Meter percent={memPct} />}
            </div>
            <div>
              <div className="microlabel mb-1">Disk</div>
              <div className="font-mono text-ink">
                {c.sizeRootFs != null ? formatBytes(c.sizeRootFs) : "—"}
              </div>
              <div className="text-ink-faint text-[0.68rem] mt-0.5">
                of which writable: {c.sizeRw != null ? formatBytes(c.sizeRw) : "—"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2 border-t border-line">
            <div>
              <div className="microlabel mb-1">{METRIC_LABELS[metric]} (live)</div>
              <div className="font-mono text-ink">
                {hasValue ? formatValue(metric, v as number) : "—"}
                {metric === "mem" && row && row.memLimit > 0 && (
                  <span className="text-ink-faint"> · {formatPercent((row.memBytes / row.memLimit) * 100, 1)}</span>
                )}
              </div>
            </div>
            <div>
              <div className="microlabel mb-1">pids</div>
              <div className="font-mono text-ink">{row?.pids ?? "—"}</div>
            </div>
            {/* ContainerRow never mounts while gpuActive or allActive (ranked rows are
                suppressed for both), but the metric prop's type still includes "gpu"
                and "all" — exclude them here too so it narrows to TelemetryMetric
                for seriesFor. */}
            {metric !== "disk" && metric !== "gpu" && metric !== "all" && (
              <div>
                <div className="microlabel mb-1">60s trend</div>
                <Sparkline values={seriesFor(samples, c.id, metric)} width={120} height={28} className="text-accent" />
              </div>
            )}
          </div>

          {widgetFields && widgetFields.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 pt-2 border-t border-line">
              {widgetFields.slice(0, 4).map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-1 min-w-0">
                  <span className="microlabel truncate">{f.label}</span>
                  <span
                    className={cn(
                      "font-mono text-xs",
                      f.intent === "warn" && "text-warn",
                      f.intent === "bad" && "text-bad",
                      f.intent === "ok" && "text-accent",
                    )}
                  >
                    {f.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
            <ContainerActions id={c.id} running={running} onDone={onActionDone} />
            <Link
              href={`/containers/${c.id.slice(0, 12)}`}
              className="text-xs text-ink-dim hover:text-accent flex items-center gap-1"
            >
              Details <ExternalLink size={11} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResourcesPage() {
  // useSearchParams in the inner component needs a Suspense boundary for the
  // static prerender (Next 15 CSR-bailout rule).
  return (
    <Suspense fallback={null}>
      <ResourcesPageInner />
    </Suspense>
  );
}

function ResourcesPageInner() {
  const { data, mutate } = useResources(10000);
  const { data: widgetData } = useWidgets(20000);
  const { samples, status } = useTelemetryStream();
  const [metric, setMetric] = useState<Metric>("cpu");
  const diskActive = metric === "disk" || metric === "blkio";
  const gpuActive = metric === "gpu";
  // ALL swaps the page's subject from containers to host processes: the treemap,
  // ranked container rows and the host overview band all describe containers, so
  // none of them belong under this tab. ProcessTable replaces the lot.
  const allActive = metric === "all";
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDiskLabel, setExpandedDiskLabel] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Adopt ?metric= from the URL (deep-linkable, e.g. /resources?metric=all&q=bazarr).
  // Read via useSearchParams, NOT window.location: on a client-side <Link>
  // navigation, effects can run before Next has committed the new URL to
  // history, so window.location still shows the previous page's search and the
  // deep link is lost — then the sync effect below stamps the stale default
  // back over the real URL. useSearchParams always carries the target route's
  // params. (Reading in an effect rather than the useState initialiser still
  // matters: it avoids a server/client hydration mismatch on hard loads.)
  const searchParams = useSearchParams();
  useEffect(() => {
    const requested = searchParams.get("metric");
    if (isMetric(requested)) setMetric(requested);
  }, [searchParams]);

  // ?q= deep link into the ALL tab's process/container filter (ProcessTable
  // takes an initialQuery prop; this is the other half).
  const [initialQuery, setInitialQuery] = useState<string | undefined>(undefined);
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setInitialQuery(q);
  }, [searchParams]);

  // Keep the URL in sync with the selected metric from the CLICK HANDLER, never
  // from an effect. A [metric]-dependent sync effect races the deep-link
  // adoption above on mount — and dev StrictMode's double effect pass defeats
  // any skip-first-run ref, stamping the stale default over ?metric=all before
  // the adopted value has re-rendered. User selection is the only moment the
  // URL should change, so that is the only place that writes it.
  const selectMetric = (m: Metric) => {
    setMetric(m);
    const params = new URLSearchParams(window.location.search);
    params.set("metric", m);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  };

  const containers = data?.containers ?? [];
  const latest = samples[samples.length - 1];

  const { active, idle } = useMemo(() => {
    const a: ResourceContainer[] = [];
    const i: ResourceContainer[] = [];
    for (const c of containers) {
      const v = valueOf(c, metric, latest?.containers[c.id]);
      if (v != null && v > 0) a.push(c);
      else i.push(c);
    }
    a.sort(
      (x, y) =>
        (valueOf(y, metric, latest?.containers[y.id]) ?? 0) - (valueOf(x, metric, latest?.containers[x.id]) ?? 0),
    );
    i.sort((x, y) => x.name.localeCompare(y.name));
    return { active: a, idle: i };
  }, [containers, metric, latest]);

  const max = Math.max(1, ...active.map((c) => valueOf(c, metric, latest?.containers[c.id]) ?? 0));

  const overviewModel = useMemo(
    () => buildOverviewModel(metric, latest?.host, samples, latest?.containers),
    [metric, latest, samples],
  );

  // Metrics history (G1): CPU/MEM only, one shared range + comparison selection so
  // flipping between the two tabs keeps whatever the owner was just comparing.
  const historyMetric = metric === "cpu" || metric === "mem" ? metric : null;
  const [historyRange, setHistoryRange] = useState<HistoryRangeOption>("live");
  const [historyContainers, setHistoryContainers] = useState<string[]>([]);
  function toggleHistoryContainer(name: string) {
    setHistoryContainers((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 4) return prev; // cap — matches the picker's own disabled state
      return [...prev, name];
    });
  }
  const historyKey =
    historyMetric && historyRange !== "live"
      ? `/api/telemetry/history?range=${historyRange}&containers=${encodeURIComponent(historyContainers.join(","))}`
      : null;
  // ~30s cadence, and only while a history range is actually selected — LIVE mode
  // (the default) polls nothing extra beyond the existing 1Hz SSE stream.
  const { data: historyData, isLoading: historyLoading } = useSWR<HistoryApiResponse>(historyKey, fetcher, {
    refreshInterval: 30000,
    keepPreviousData: true,
  });
  const historyBucketTimes = useMemo(() => historyData?.host.map((b) => b.t) ?? [], [historyData]);
  const historyHostPoints = useMemo(() => {
    if (!historyData || !historyMetric) return undefined;
    return historyData.host.map((b) => (historyMetric === "cpu" ? b.cpuPct : b.memBytes));
  }, [historyData, historyMetric]);
  const historyContainerPoints = useMemo(() => {
    if (!historyData || !historyMetric) return {};
    const out: Record<string, (number | null)[]> = {};
    for (const [name, buckets] of Object.entries(historyData.containers)) {
      out[name] = buckets.map((b) => (historyMetric === "cpu" ? b.cpuPct : b.memBytes));
    }
    return out;
  }, [historyData, historyMetric]);
  // Busiest-first, mirroring the ranked rows below — the containers worth
  // comparing are usually the ones already leading the current metric.
  const historyContainerOptions = useMemo(() => [...active, ...idle].map((c) => c.name), [active, idle]);

  const treemapItems: TreemapItem[] = useMemo(
    () => active.map((c) => ({ id: c.id, label: c.name, value: valueOf(c, metric, latest?.containers[c.id]) ?? 0 })),
    [active, metric, latest],
  );
  // The d3-hierarchy squarify layout re-runs on every 1Hz sample; deferring it keeps
  // hover/click/resize interactions from queuing behind that work.
  const deferredTreemapItems = useDeferredValue(treemapItems);

  function handleCellClick(id: string) {
    setExpandedId(id);
    rowRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const volumes = data?.volumes ?? null;
  const sortedVolumes = useMemo(() => {
    if (!volumes) return [];
    return [...volumes].sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1));
  }, [volumes]);
  const maxVolume = Math.max(1, ...sortedVolumes.map((v) => v.sizeBytes ?? 0));

  const hostDisks = data?.hostDisks ?? null;
  // Flattened, deduped mountpoints across every disk group — feeds the DISK
  // GROWTH panel's mount picker. Growth is charted per raw mountpoint (what
  // metrics-history actually records), not per disk-group label, so a
  // multi-partition disk still shows one line per partition.
  const allMountpoints = useMemo(() => {
    if (!hostDisks) return [];
    const set = new Set<string>();
    for (const d of hostDisks) for (const m of d.mounts ?? [d.mount]) set.add(m);
    return [...set];
  }, [hostDisks]);
  const dockerRootDir = data?.dockerRootDir ?? null;
  const writableLayers = useMemo(
    () => containers.reduce((a, c) => a + (c.sizeRw ?? 0), 0),
    [containers],
  );
  // Fallback when dockerRootDir is unknown: the drive containing "/" or the largest drive (approximate).
  const fallbackDisk = useMemo(() => {
    if (!hostDisks || hostDisks.length === 0) return null;
    return (
      hostDisks.find((d) => (d.mounts ?? [d.mount]).includes("/")) ??
      [...hostDisks].sort((a, b) => b.total - a.total)[0]
    );
  }, [hostDisks]);
  // The drive with a mountpoint that's the longest prefix of dockerRootDir owns the docker segments.
  const dockerDisk = useMemo(() => {
    if (!hostDisks || hostDisks.length === 0) return null;
    if (!dockerRootDir) return fallbackDisk;
    let best: HostDisk | null = null;
    let bestLen = -1;
    for (const d of hostDisks) {
      for (const mp of d.mounts ?? [d.mount]) {
        if (isMountPrefixOf(mp, dockerRootDir) && mp.length > bestLen) {
          best = d;
          bestLen = mp.length;
        }
      }
    }
    return best ?? fallbackDisk;
  }, [hostDisks, dockerRootDir, fallbackDisk]);
  const dfFailed = volumes === null;
  const dockerSegments = useMemo((): DiskSegment[] => {
    if (!dockerDisk || !data) return [];
    const segs: DiskSegment[] = [];
    if (!dfFailed) {
      const { totals } = data;
      if (totals.layersSize > 0) segs.push({ key: "images", label: "images", value: totals.layersSize, fill: "#134e4a" });
      if (writableLayers > 0) segs.push({ key: "writable", label: "writable layers", value: writableLayers, fill: "#0f766e" });
      if (totals.volumeDisk > 0) segs.push({ key: "volumes", label: "volumes", value: totals.volumeDisk, fill: "#0d9488" });
      if (totals.buildCacheBytes > 0) segs.push({ key: "buildcache", label: "build cache", value: totals.buildCacheBytes, fill: "#14b8a6" });
    }
    const dockerTotal = segs.reduce((a, s) => a + s.value, 0);
    const otherUsed = Math.max(0, dockerDisk.used - dockerTotal);
    if (otherUsed > 0) segs.push({ key: "other", label: "other used", value: otherUsed, fill: "var(--color-line-bright)" });
    const free = Math.max(0, dockerDisk.total - dockerDisk.used);
    segs.push({ key: "free", label: "free", value: free, fill: "var(--color-panel-2)" });
    return segs;
  }, [dockerDisk, data, writableLayers, dfFailed]);
  const panelLegend = useMemo(() => {
    if (!hostDisks) return [];
    const present = new Set<string>();
    for (const d of hostDisks) {
      const segs = d === dockerDisk ? dockerSegments : otherDiskSegments(d);
      for (const s of segs) present.add(s.key);
    }
    return SEGMENT_LEGEND.filter((s) => present.has(s.key));
  }, [hostDisks, dockerDisk, dockerSegments]);

  return (
    <div className="space-y-4 pb-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Resources</h1>
        <p className="microlabel mt-0.5">
          {containers.length} containers
          {data ? ` · updated ${relativeTime(data.updatedAt)}` : ""}
        </p>
      </header>

      {/* totals strip */}
      <div className="panel px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:items-center sm:flex-wrap text-xs">
        <div>
          <div className="microlabel">CPU</div>
          <div className="font-mono text-ink mt-0.5">{formatPercent(data?.totals.cpuPct, 1)}</div>
        </div>
        <div>
          <div className="microlabel">MEM</div>
          <div className="font-mono text-ink mt-0.5">
            {formatBytes(data?.totals.memBytes)} / {formatBytes(data?.totals.memTotal)}
          </div>
        </div>
        <div>
          <div className="microlabel">CONTAINER DISK</div>
          <div
            className="font-mono text-ink mt-0.5"
            title="image + writable layer; shared image layers counted once per container"
          >
            {formatBytes(data?.totals.containerDisk)}
          </div>
        </div>
        {volumes && volumes.length > 0 && (
          <div>
            <div className="microlabel">VOLUME DISK</div>
            <div className="font-mono text-ink mt-0.5">{formatBytes(data?.totals.volumeDisk)}</div>
          </div>
        )}
      </div>

      {/* segmented control */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="panel p-1 flex gap-1 flex-1 min-w-0" role="group" aria-label="Resource metric">
          {TAB_METRICS.map((m) => (
            <SegmentButton
              key={m}
              fill
              active={m === "disk" ? diskActive : metric === m}
              label={ACCESSIBLE_METRIC_LABELS[m]}
              onClick={() => {
                // DISK owns a sub-view (STORAGE / I/O). Re-tapping the tab you are
                // already on must not silently reset you from I/O back to STORAGE.
                if (m === "disk" && diskActive) return;
                selectMetric(m);
              }}
            >
              {METRIC_LABELS[m]}
            </SegmentButton>
          ))}
        </div>
        {status === "lost" && !allActive && (
          <div className="microlabel !text-warn/80 shrink-0">connection lost — reconnecting</div>
        )}
      </div>

      {/* disk sub-view toggle: storage (bytes on disk) vs i/o (throughput rate) — same tab, different lens */}
      {diskActive && (
        <div className="space-y-1.5">
          <div className="microlabel">disk view</div>
          <div className="panel p-1 flex gap-1 w-fit">
            <SegmentButton active={metric === "disk"} onClick={() => selectMetric("disk")}>
              STORAGE
            </SegmentButton>
            <SegmentButton active={metric === "blkio"} onClick={() => selectMetric("blkio")}>
              I/O
            </SegmentButton>
          </div>
        </div>
      )}

      {/* host-level overview for the selected metric — DISK is excluded, the HOST DISK
          panel below already fills that role and must not be duplicated; GPU is
          excluded because GpuView owns its own VRAM overview band below */}
      {metric !== "disk" && !gpuActive && !allActive && (
        <div className={cn(status === "lost" && "opacity-50 transition-opacity")}>
          <ResourceOverview key={metric} title={METRIC_LABELS[metric]} model={overviewModel} />
        </div>
      )}

      {/* CPU/MEM only: long-range history — a range control always shown, plus
          (once off LIVE) the comparison chart. LIVE needs nothing extra here; the
          panel above already carries the 60s trend via overviewModel.series. */}
      {historyMetric && (
        <div className="panel p-4">
          <MetricHistoryPanel
            range={historyRange}
            onRangeChange={setHistoryRange}
            containerOptions={historyContainerOptions}
            selectedContainers={historyContainers}
            onToggleContainer={toggleHistoryContainer}
            hostPoints={historyHostPoints}
            containerPoints={historyContainerPoints}
            bucketTimes={historyBucketTimes}
            formatValue={(v) => formatValue(historyMetric, v)}
            recordingSince={historyData?.recordingSince ?? null}
            isLoading={historyLoading}
          />
        </div>
      )}

      {/* GPU metric view — its own band-stack (verdict, thermal/core, VRAM, NVENC,
          transcode streams), replacing the treemap/ranked-rows grammar below */}
      {gpuActive && <GpuView samples={samples} status={status} />}

      {/* ALL — every host process, sortable on each column, with live filtering.
          Polls /api/processes on its own cadence and only while mounted, so the
          ~476 /proc reads never happen for the five container tabs. `?q=<name>`
          prefills the filter (see the mount effect above); other container
          surfaces link here via `/resources?metric=all&q=<name>`. */}
      {allActive && <ProcessTable initialQuery={initialQuery} />}

      {/* host disk breakdown (disk view only) */}
      {metric === "disk" && hostDisks && hostDisks.length > 0 && (
        <div className="panel p-4">
          <div className="microlabel mb-3">HOST DISK</div>

          <div className="space-y-4">
            {hostDisks.map((d) => {
              const isDockerDisk = d === dockerDisk;
              const segs = isDockerDisk ? dockerSegments : otherDiskSegments(d);
              const isDiskExpanded = expandedDiskLabel === d.mount;
              return (
                <div key={d.mount}>
                  <button
                    type="button"
                    onClick={() => setExpandedDiskLabel(isDiskExpanded ? null : d.mount)}
                    aria-expanded={isDiskExpanded}
                    aria-controls={`disk-contents-${d.mount}`}
                    className="w-full flex items-center justify-between gap-2 mb-1.5 min-h-11 md:min-h-0 -mx-1 px-1 rounded-md text-left cursor-pointer hover:bg-panel-2/60"
                  >
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="font-mono text-xs text-ink shrink-0">{d.mount}</span>
                      <span className="microlabel truncate">{(d.mounts ?? [d.mount]).join(" · ")}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs text-ink">
                        {formatBytes(d.used)} / {formatBytes(d.total)}
                      </span>
                      <span className="microlabel hidden sm:inline">CONTENTS</span>
                      <ChevronDown
                        size={13}
                        className={cn("text-ink-faint transition-transform", isDiskExpanded && "rotate-180")}
                      />
                    </div>
                  </button>

                  <div className="h-5 rounded-md overflow-hidden flex gap-[2px] bg-line">
                    {segs.map((seg) => {
                      const pct = d.total > 0 ? (seg.value / d.total) * 100 : 0;
                      const dockerSeg = isDockerDisk && isDockerSegKey(seg.key);
                      const title =
                        dockerSeg && !dockerRootDir && !(d.mounts ?? [d.mount]).includes("/")
                          ? "approximate — docker root may be on another filesystem"
                          : `${seg.label} · ${formatBytes(seg.value)}`;
                      const showLabel = pct >= 9 && seg.key !== "free";
                      const label = seg.key === "used" ? `used · ${formatBytes(seg.value)}` : seg.label;
                      return (
                        <div
                          key={seg.key}
                          title={title}
                          className={cn(
                            "h-full flex items-center justify-center px-1 overflow-hidden",
                            seg.key === "free" && "border-l border-line",
                          )}
                          style={{ width: `${pct}%`, background: seg.fill }}
                        >
                          {showLabel && (
                            <span
                              className={cn(
                                "text-[0.625rem] font-medium truncate",
                                seg.key === "other" ? "text-ink-dim" : "text-ink",
                              )}
                            >
                              {label}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {isDiskExpanded && (
                    <div id={`disk-contents-${d.mount}`} className="mt-3 pt-3 border-t border-line/60">
                      <DiskContentsPanel label={d.mount} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t border-line">
            {panelLegend.map((seg) => (
              <div key={seg.key} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: seg.fill }}
                />
                <span className="microlabel">{seg.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PINNED — folders marked from a CONTENTS drill-down row, always listed
          with their current size regardless of which disk group they live
          under. STORAGE-only, same gate as HOST DISK above. */}
      {metric === "disk" && <PinnedFoldersPanel />}

      {/* DISK GROWTH — mount capacity over time, from G1's metrics history.
          STORAGE-only; suppressed entirely once there are no mounts to chart
          rather than rendering an empty chart shell. */}
      {metric === "disk" && allMountpoints.length > 0 && <DiskGrowthPanel mountpoints={allMountpoints} />}

      {/* Drive health — SMART, wear, temperature, array integrity.
          Deliberately gated on diskActive rather than metric === "disk": a failing
          drive is a property of the hardware, not of the STORAGE sub-view, and an
          alert you can only see after toggling to the right lens is an alert that
          gets missed. Data comes from a host-side collector (smartctl needs root
          and raw device nodes, which this container has neither of). */}
      {diskActive && <DriveHealthPanel />}

      {/* treemap hero + ranked rows — suppressed for GPU. Only containers holding VRAM
          would ever appear in a GPU treemap — realistically one, and a single-cell
          treemap asserts a proportion that does not exist. Don't feed GPU into it. */}
      {!gpuActive && !allActive && (
        <>
          <div className={cn(status === "lost" && "opacity-50 transition-opacity")}>
            <Treemap items={deferredTreemapItems} formatValue={(v) => formatValue(metric, v)} onCellClick={handleCellClick} />
          </div>

          <div className="panel overflow-hidden">
            {active.map((c) => (
              <ContainerRow
                key={c.id}
                c={c}
                metric={metric}
                max={max}
                row={latest?.containers[c.id]}
                samples={samples}
                expanded={expandedId === c.id}
                onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                widgetFields={widgetData?.widgets[c.name]?.fields}
                onActionDone={() => mutate()}
                rowRef={(el) => {
                  rowRefs.current[c.id] = el;
                }}
              />
            ))}
            {idle.length > 0 && (
              <>
                <div className="microlabel px-3 py-2 bg-panel-2/40">idle / no data</div>
                {idle.map((c) => (
                  <ContainerRow
                    key={c.id}
                    c={c}
                    metric={metric}
                    max={max}
                    row={latest?.containers[c.id]}
                    samples={samples}
                    expanded={expandedId === c.id}
                    onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    widgetFields={widgetData?.widgets[c.name]?.fields}
                    onActionDone={() => mutate()}
                    rowRef={(el) => {
                      rowRefs.current[c.id] = el;
                    }}
                  />
                ))}
              </>
            )}
            {!containers.length && (
              <div className="p-8 text-center text-ink-faint text-sm">discovering containers…</div>
            )}
          </div>
        </>
      )}

      {/* volumes panel (disk view only) */}
      {metric === "disk" && (
        <div className="panel overflow-hidden">
          <div className="microlabel px-3 py-2 border-b border-line">Volumes</div>
          {volumes === null && (
            <div className="px-3 py-4 microlabel !text-warn/80">
              volume sizes need SYSTEM=1 on the socket proxy
            </div>
          )}
          {volumes !== null && sortedVolumes.length === 0 && (
            <div className="px-3 py-4 text-center text-ink-faint text-sm">
              No named volumes — app data on this box lives in bind mounts.
            </div>
          )}
          {sortedVolumes.map((v) => (
            <div
              key={v.name}
              title={`${v.name}: ${v.sizeBytes != null ? formatBytes(v.sizeBytes) : "unknown size"}`}
              className="flex items-center gap-2.5 min-h-11 md:min-h-8 px-3 py-1.5 border-b border-line/50 last:border-0 hover:bg-panel-2/60"
            >
              <span className="font-mono text-[0.75rem] break-all flex-1 min-w-0">{v.name}</span>
              <div className="hidden sm:block w-32 md:w-40 h-1.5 rounded-full bg-panel-2 overflow-hidden shrink-0">
                {v.sizeBytes != null && v.sizeBytes > 0 && (
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, (v.sizeBytes / maxVolume) * 100)}%`, background: "var(--color-accent-dim)" }}
                  />
                )}
              </div>
              <span className="font-mono text-[0.75rem] text-ink w-20 text-right shrink-0">
                {v.sizeBytes != null ? formatBytes(v.sizeBytes) : "—"}
              </span>
              <span className="microlabel shrink-0">{v.refCount} refs</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
