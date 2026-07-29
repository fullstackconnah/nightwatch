/* THESIS: one glance answers "what is eating this box" — proportion first, numbers second; refuses the category default of a stats table with a chart bolted on.
   OWN-WORLD: nightwatch homelab console — near-black #070b11, .panel hairlines, teal accent as the single data hue, mono numerals, 10px microlabels; magnitude = bar length / cell area, never rainbow.
   STORY: the owner taps CPU/MEM/DISK, sees the top consumer instantly, taps a row for that container's live detail + widget data + actions.
   FIRST VIEWPORT: totals strip, CPU/MEM/DISK segmented toggle, squarified treemap hero (~38vh), ranked bar list beginning beneath — top consumer visible without scrolling.
   FORM: interactive treemap + ranked proportional bars, per user selection; drill-in = inline row expansion.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Play, RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/charts";
import { Treemap, type TreemapItem } from "@/components/treemap";
import { cn } from "@/lib/utils";
import { formatBytes, formatPercent, relativeTime } from "@/lib/format";
import {
  postJson,
  useResources,
  useWidgets,
  type ResourceSnapshot,
} from "@/lib/client";

type Metric = "cpu" | "mem" | "disk";

type ResourceContainer = ResourceSnapshot["containers"][number];

function valueOf(c: ResourceContainer, metric: Metric): number | null {
  if (metric === "cpu") return c.cpuPct;
  if (metric === "mem") return c.memBytes;
  return c.sizeRootFs;
}

function formatValue(metric: Metric, v: number): string {
  if (metric === "cpu") return formatPercent(v, 1);
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
  expanded,
  onToggle,
  widgetFields,
  onActionDone,
  rowRef,
}: {
  c: ResourceContainer;
  metric: Metric;
  max: number;
  expanded: boolean;
  onToggle: () => void;
  widgetFields: { label: string; value: string; intent?: "ok" | "warn" | "bad" }[] | undefined;
  onActionDone: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const v = valueOf(c, metric);
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
        className="w-full flex items-center gap-2.5 min-h-11 md:min-h-8 px-3 py-1.5 text-left cursor-pointer hover:bg-panel-2/60"
      >
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

          {widgetFields && widgetFields.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 border-t border-line">
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
  const [metric, setMetric] = useState<Metric>("cpu");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const containers = data?.containers ?? [];

  const { active, idle } = useMemo(() => {
    const a: ResourceContainer[] = [];
    const i: ResourceContainer[] = [];
    for (const c of containers) {
      const v = valueOf(c, metric);
      if (v != null && v > 0) a.push(c);
      else i.push(c);
    }
    a.sort((x, y) => (valueOf(y, metric) ?? 0) - (valueOf(x, metric) ?? 0));
    i.sort((x, y) => x.name.localeCompare(y.name));
    return { active: a, idle: i };
  }, [containers, metric]);

  const max = Math.max(1, ...active.map((c) => valueOf(c, metric) ?? 0));

  const treemapItems: TreemapItem[] = useMemo(
    () => active.map((c) => ({ id: c.id, label: c.name, value: valueOf(c, metric) ?? 0 })),
    [active, metric],
  );

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
          <div className="font-mono text-ink mt-0.5">{formatBytes(data?.totals.containerDisk)}</div>
        </div>
        {volumes && volumes.length > 0 && (
          <div>
            <div className="microlabel">VOLUME DISK</div>
            <div className="font-mono text-ink mt-0.5">{formatBytes(data?.totals.volumeDisk)}</div>
          </div>
        )}
      </div>

      {/* segmented control */}
      <div className="panel p-1 flex gap-1">
        <SegmentButton active={metric === "cpu"} onClick={() => setMetric("cpu")}>
          CPU
        </SegmentButton>
        <SegmentButton active={metric === "mem"} onClick={() => setMetric("mem")}>
          MEMORY
        </SegmentButton>
        <SegmentButton active={metric === "disk"} onClick={() => setMetric("disk")}>
          DISK
        </SegmentButton>
      </div>

      {metric === "disk" && volumes === null && (
        <div className="microlabel !text-warn/80">
          volume sizes need SYSTEM=1 on the socket proxy
        </div>
      )}

      {/* treemap hero */}
      <Treemap items={treemapItems} formatValue={(v) => formatValue(metric, v)} onCellClick={handleCellClick} />

      {/* ranked bars */}
      <div className="panel overflow-hidden">
        {active.map((c) => (
          <ContainerRow
            key={c.id}
            c={c}
            metric={metric}
            max={max}
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
