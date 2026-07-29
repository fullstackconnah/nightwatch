/* THESIS: one glance answers "what is eating this box" — proportion first, numbers second; refuses the category default of a stats table with a chart bolted on.
   OWN-WORLD: nightwatch homelab console — near-black #070b11, .panel hairlines, teal accent as the single data hue, mono numerals, 10px microlabels; magnitude = bar length / cell area, never rainbow.
   STORY: the owner taps CPU/MEM/DISK, sees the top consumer instantly, taps a row for that container's live detail + widget data + actions.
   FIRST VIEWPORT: totals strip, CPU/MEM/DISK segmented toggle, squarified treemap hero (~38vh), ranked bar list beginning beneath — top consumer visible without scrolling.
   FORM: interactive treemap + ranked proportional bars, per user selection; drill-in = inline row expansion.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Play, RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/charts";
import { Sparkline } from "@/components/sparkline";
import { Treemap, type TreemapItem } from "@/components/treemap";
import { cn } from "@/lib/utils";
import { formatBytes, formatPercent, formatRate, relativeTime } from "@/lib/format";
import {
  postJson,
  useDiskUsage,
  refreshDiskUsage,
  useResources,
  useTelemetryStream,
  useWidgets,
  seriesFor,
  type ResourceSnapshot,
  type DiskUsageScan,
  type TelemetryRow,
  type TelemetrySample,
} from "@/lib/client";

type Metric = "cpu" | "mem" | "disk" | "net" | "blkio";

const ALL_METRICS: readonly Metric[] = ["cpu", "mem", "disk", "net", "blkio"];

const METRIC_LABELS: Record<Metric, string> = {
  cpu: "CPU",
  mem: "MEMORY",
  disk: "DISK",
  net: "NETWORK",
  blkio: "DISK I/O",
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
  { key: "other", label: "other used", value: 0, fill: "#2a3a50" },
  { key: "used", label: "used", value: 0, fill: "#0f766e" },
  { key: "free", label: "free", value: 0, fill: "var(--color-panel-2)" },
];

const CONTENTS_RAMP = ["#134e4a", "#0f766e", "#0d9488", "#14b8a6"];
const NEUTRAL_FILL = "#2a3a50";

interface ContentsRow {
  key: string;
  label: string;
  bytes: number;
  fill: string;
  badge?: "mount" | "file";
  /** Overrides the default "label · value" tooltip. */
  title?: string;
}

function contentsRows(scan: DiskUsageScan): ContentsRow[] {
  const rows: ContentsRow[] = scan.entries.map((e, i) => ({
    key: `${e.kind}-${e.name}`,
    label: e.name,
    bytes: e.bytes,
    fill: CONTENTS_RAMP[i % CONTENTS_RAMP.length],
    badge: e.kind === "mount" || e.kind === "file" ? e.kind : undefined,
  }));
  if (scan.otherBytes > 0) rows.push({ key: "other", label: "other", bytes: scan.otherBytes, fill: NEUTRAL_FILL });
  // Two distinct, honestly-labeled buckets for the remainder — never both at once (see
  // DiskUsageScan's docstring): permission-denied space is NOT "filesystem overhead".
  if (scan.unreadableBytes > 0)
    rows.push({
      key: "unreadable",
      label: `unreadable · ${scan.deniedCount} paths denied`,
      bytes: scan.unreadableBytes,
      fill: NEUTRAL_FILL,
      title: "not readable as the dashboard's unprivileged user",
    });
  if (scan.unaccountedBytes > 0)
    rows.push({
      key: "unaccounted",
      label: "unaccounted (filesystem overhead)",
      bytes: scan.unaccountedBytes,
      fill: NEUTRAL_FILL,
    });
  return rows;
}

/** Drill-in "what's using the space" breakdown for one HOST DISK row, fetched on expand. */
function DiskContentsPanel({ label }: { label: string }) {
  const { data: scan, isLoading } = useDiskUsage(label);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  async function handleRescan() {
    setRescanning(true);
    setRescanError(null);
    try {
      await refreshDiskUsage(label);
    } catch (e) {
      setRescanError(e instanceof Error ? e.message : "rescan failed");
    } finally {
      setRescanning(false);
    }
  }

  if (isLoading && !scan) {
    return (
      <div className="py-2 space-y-1">
        <div className="microlabel">scanning contents…</div>
        <div className="text-ink-faint text-xs">large drives can take a few minutes</div>
      </div>
    );
  }

  if (!scan) {
    return <div className="py-2 text-ink-faint text-xs">no contents data</div>;
  }

  const rows = contentsRows(scan);
  const maxBytes = Math.max(1, ...rows.map((r) => r.bytes));

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="microlabel">CONTENTS</div>
        {scan.deniedCount > 0 && (
          <div className="microlabel !text-warn/80">
            {Math.round(100 - scan.readablePct)}% of used space not readable
          </div>
        )}
      </div>

      <div className="h-5 rounded-md overflow-hidden flex gap-[2px] bg-line">
        {rows.map((r) => {
          const pct = scan.usedBytes > 0 ? (r.bytes / scan.usedBytes) * 100 : 0;
          const showLabel = pct >= 9;
          return (
            <div
              key={r.key}
              title={r.title ?? `${r.label} · ${formatBytes(r.bytes)}`}
              className="h-full flex items-center justify-center px-1 overflow-hidden"
              style={{ width: `${pct}%`, background: r.fill }}
            >
              {showLabel && <span className="text-[0.625rem] font-medium truncate text-ink">{r.label}</span>}
            </div>
          );
        })}
      </div>

      <div className="divide-y divide-line/50">
        {rows.map((r) => (
          <div
            key={r.key}
            title={r.title}
            className="flex items-center gap-2.5 min-h-11 md:min-h-8 py-1.5"
          >
            <span className="font-mono text-[0.75rem] break-all flex-1 min-w-0">
              {r.badge && <span className="microlabel mr-1.5">{r.badge}</span>}
              {r.label}
            </span>
            <div className="hidden sm:block w-32 md:w-40 h-1.5 rounded-full bg-panel-2 overflow-hidden shrink-0">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, (r.bytes / maxBytes) * 100)}%`, background: "#2dd4bf" }}
              />
            </div>
            <span className="font-mono text-[0.75rem] text-ink w-20 text-right shrink-0">
              {formatBytes(r.bytes)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        <div className="microlabel">
          scanned {relativeTime(scan.scannedAt)} · {(scan.durationMs / 1000).toFixed(1)}s
        </div>
        <Button size="sm" variant="ghost" disabled={rescanning} onClick={handleRescan}>
          <RotateCw size={12} className={rescanning ? "animate-spin" : ""} /> Rescan
        </Button>
      </div>

      {rescanError && <div className="microlabel !text-warn/80">{rescanError}</div>}

      {(scan.partial || scan.error) && (
        <div className="microlabel !text-warn/80">{scan.error ?? "partial scan — some data may be incomplete"}</div>
      )}
    </div>
  );
}

function valueOf(c: ResourceContainer, metric: Metric, row: TelemetryRow | undefined): number | null {
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

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 h-11 md:h-8 px-3 rounded-md text-xs font-medium transition cursor-pointer border",
        active
          ? "bg-accent/10 text-accent border-accent/30"
          : "text-ink-dim border-transparent hover:text-ink hover:bg-panel-2",
      )}
    >
      {children}
    </button>
  );
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
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#2dd4bf" }} />
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
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#2dd4bf" }} />
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
            {metric !== "disk" && (
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
  const { data, mutate } = useResources(10000);
  const { data: widgetData } = useWidgets(20000);
  const { samples, status } = useTelemetryStream();
  const [metric, setMetric] = useState<Metric>("cpu");
  const diskActive = metric === "disk" || metric === "blkio";
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDiskLabel, setExpandedDiskLabel] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Mount-only: adopt ?metric= from the URL if present and valid (deep-linkable, e.g.
  // /resources?metric=net). Reading in an effect rather than the useState initialiser
  // avoids a server/client hydration mismatch.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("metric");
    if (isMetric(requested)) setMetric(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL in sync with the selected metric without a Next navigation/scroll.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("metric", metric);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [metric]);

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
    if (otherUsed > 0) segs.push({ key: "other", label: "other used", value: otherUsed, fill: "#2a3a50" });
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
        <div className="panel p-1 flex gap-1 flex-1 min-w-0">
          <SegmentButton active={metric === "cpu"} onClick={() => setMetric("cpu")}>
            {METRIC_LABELS.cpu}
          </SegmentButton>
          <SegmentButton active={metric === "mem"} onClick={() => setMetric("mem")}>
            {METRIC_LABELS.mem}
          </SegmentButton>
          <SegmentButton active={diskActive} onClick={() => !diskActive && setMetric("disk")}>
            {METRIC_LABELS.disk}
          </SegmentButton>
          <SegmentButton active={metric === "net"} onClick={() => setMetric("net")}>
            {METRIC_LABELS.net}
          </SegmentButton>
        </div>
        {status === "lost" && (
          <div className="microlabel !text-warn/80 shrink-0">connection lost — reconnecting</div>
        )}
      </div>

      {/* disk sub-view toggle: storage (bytes on disk) vs i/o (throughput rate) — same tab, different lens */}
      {diskActive && (
        <div className="space-y-1.5">
          <div className="microlabel">disk view</div>
          <div className="panel p-1 flex gap-1 w-fit">
            <SegmentButton active={metric === "disk"} onClick={() => setMetric("disk")}>
              STORAGE
            </SegmentButton>
            <SegmentButton active={metric === "blkio"} onClick={() => setMetric("blkio")}>
              I/O
            </SegmentButton>
          </div>
        </div>
      )}

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

      {/* treemap hero — dimmed (not unmounted) while the telemetry stream is reconnecting,
          since EventSource auto-reconnects and the last samples are still meaningful */}
      <div className={cn(status === "lost" && "opacity-50 transition-opacity")}>
        <Treemap items={deferredTreemapItems} formatValue={(v) => formatValue(metric, v)} onCellClick={handleCellClick} />
      </div>

      {/* ranked bars */}
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
                    style={{ width: `${Math.min(100, (v.sizeBytes / maxVolume) * 100)}%`, background: "#2dd4bf" }}
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
