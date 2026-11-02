"use client";

/*
 * The /resources watchlist (CPU and MEM): a calm leaderboard of the busiest containers, with the
 * quiet and stopped ones folded away. Shape brief: design-handoff/resources-redesign.md s2.2-2.4, 3, 4, 6, 7.
 *
 * Calm-motion contract: the order is committed by a Ranker (at most every 4 s, never while held).
 * Rows are absolutely placed; translateY is set in ONE layout effect keyed on the visible order, the
 * open id, the folds and a resize bump. A 1 Hz tick only re-renders rows whose text or bar changed
 * (memo equality) and never reads layout.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, GitCompare, List, Plus, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Meter } from "@/components/charts";
import { Sparkline } from "@/components/sparkline";
import { CreateContainerDialog } from "@/components/resources/create-container";
import { LifecycleActions, LifecycleError, useLifecycle } from "@/components/resources/container-controls";
import { SeriesSwatch } from "@/components/resources/resource-overview";
import { SERIES_SLOTS, type SeriesSlot } from "@/lib/chart-series";
import { ApiError, seriesFor, type ResourceSnapshot, type TelemetryRow, type TelemetrySample } from "@/lib/client";
import { formatBytes, formatPercent, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CPU_STEPS,
  MEM_STEPS,
  QUIET_CPU,
  createRanker,
  quietCap,
  snapScale,
  splitWatch,
  type Ranker,
  type WatchSplit,
} from "@/lib/watchlist";

type ResourceContainer = ResourceSnapshot["containers"][number];
export type WidgetField = { label: string; value: string; intent?: "ok" | "warn" | "bad" };

/** Field-by-field, not `===`: `row` is a fresh object out of every 1 Hz telemetry sample even when a
 *  container is genuinely idle, so comparing by reference would never let a quiet row skip a render. */
export function telemetryRowEqual(a: TelemetryRow | undefined, b: TelemetryRow | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.cpuPct === b.cpuPct &&
    a.memBytes === b.memBytes &&
    a.memLimit === b.memLimit &&
    a.rxRate === b.rxRate &&
    a.txRate === b.txRate &&
    a.blkReadRate === b.blkReadRate &&
    a.blkWriteRate === b.blkWriteRate &&
    a.pids === b.pids
  );
}

const sparkEqual = (a: number[] | null, b: number[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

/** Start / stop / restart (+ pause) with its inline error, for rows outside the watchlist (DISK, NET). */
export function LifecycleGroup({ c, onDone }: { c: ResourceContainer; onDone: () => void }) {
  const lifecycle = useLifecycle(c.id, onDone);
  return (
    <div className="flex flex-col gap-1">
      <LifecycleActions state={c.state} name={c.name} lifecycle={lifecycle} />
      <LifecycleError lifecycle={lifecycle} />
    </div>
  );
}

type Group = "watch" | "quiet" | "stopped";

interface RowProps {
  c: ResourceContainer;
  kind: "cpu" | "mem";
  group: Group;
  rank: number;
  row: TelemetryRow | undefined;
  scale: number;
  /** null when the row draws no sparkline (stopped or no data). */
  spark: number[] | null;
  open: boolean;
  slot: SeriesSlot | null;
  compared: boolean;
  compareFull: boolean;
  widgetFields: WidgetField[] | undefined;
  onToggle: (id: string) => void;
  onCompare: (name: string) => void;
  onChanged: () => void;
  register: (key: string, el: HTMLElement | null) => void;
}

/** Callbacks are excluded on purpose: the parent's versions are behaviourally identical per row. */
function rowEqual(p: RowProps, n: RowProps): boolean {
  return (
    p.c === n.c &&
    p.kind === n.kind &&
    p.group === n.group &&
    p.rank === n.rank &&
    p.scale === n.scale &&
    p.open === n.open &&
    p.slot === n.slot &&
    p.compared === n.compared &&
    p.compareFull === n.compareFull &&
    p.widgetFields === n.widgetFields &&
    telemetryRowEqual(p.row, n.row) &&
    sparkEqual(p.spark, n.spark)
  );
}

const WatchRow = memo(function WatchRow(p: RowProps) {
  const { c, kind, row, scale, spark, open, slot, register } = p;
  const isCpu = kind === "cpu";
  const v = row ? (isCpu ? row.cpuPct : row.memBytes) : null;
  const noData = v == null;
  const running = c.state === "running";
  const text = noData ? "no data" : isCpu ? formatPercent(v, v < 0.1 ? 2 : 1) : formatBytes(v);
  const frac = noData || scale <= 0 ? 0 : Math.min(1, v / scale);
  const ref = useCallback((el: HTMLDivElement | null) => register(c.id, el), [register, c.id]);
  const detailId = `wl-det-${c.id.slice(0, 12)}`;

  return (
    <div ref={ref} role="listitem" className="wl-item" data-row-id={c.id} data-rank={p.rank} data-open={open || undefined}>
      <button
        type="button"
        className="wl-rowbtn"
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={() => p.onToggle(c.id)}
        title={`${c.name}: ${text}`}
      >
        <span className={cn("dot wl-dot", running ? "dot-running" : "dot-stopped")} />
        <span className={cn("wl-name font-mono text-[0.8rem]", noData && "text-ink-faint")}>{c.name}</span>
        <span className="wl-cmp">{slot && <SeriesSwatch slot={slot} />}</span>
        <span className="wl-spark">
          {spark && <Sparkline values={spark} width={72} height={20} className="text-accent" />}
        </span>
        <span className="wl-bar">
          <span className={cn("wl-track", noData && "wl-hatch")}>
            <span className="wl-fill" style={{ transform: `scaleX(${frac.toFixed(4)})` }} />
          </span>
        </span>
        <span className={cn("wl-val font-mono text-[0.75rem]", noData ? "text-ink-faint" : "text-ink")}>{text}</span>
        <ChevronDown size={13} className="wl-chev" aria-hidden />
      </button>
      {open && <RowDetail id={detailId} {...p} />}
    </div>
  );
}, rowEqual);

function Cell({ label, value, sub, dim, children }: { label: string; value: string; sub?: string; dim?: boolean; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="microlabel mb-1">{label}</div>
      <div className={cn("wl-dval font-mono text-sm", dim ? "text-ink-faint motion-safe:animate-pulse" : "text-ink")}>{value}</div>
      <div className="wl-dsub font-mono text-2xs text-ink-dim min-h-[1.05rem]">{sub}</div>
      {children}
    </div>
  );
}

/** The open row (2.4): detail fields, image, integration fields, then the actions (s6, 7.2). */
function RowDetail({ id, c, row, widgetFields, compared, compareFull, onCompare, onChanged }: RowProps & { id: string }) {
  const lifecycle = useLifecycle(c.id, onChanged);
  const memPct = row && row.memLimit > 0 ? (row.memBytes / row.memLimit) * 100 : null;
  const sizesLate = c.sizeRootFs == null || c.sizeRw == null;
  const link = cn(buttonVariants({ variant: "outline", size: "sm" }), "md:h-8");
  return (
    <div id={id} className="wl-detail">
      <div className="wl-dgrid">
        <Cell label="CPU" value={row ? formatPercent(row.cpuPct, 2) : "no data"} sub={row ? "of the whole box" : ""} />
        <Cell
          label="Memory"
          value={row ? formatBytes(row.memBytes) : "no data"}
          sub={memPct == null ? (row ? "no limit set" : "") : `${formatPercent(memPct, 1)} of ${formatBytes(row?.memLimit)} limit`}
        >
          <div className={cn("mt-1", memPct == null && "invisible")} aria-hidden={memPct == null}>
            <Meter percent={memPct ?? 0} />
          </div>
        </Cell>
        <Cell
          label="Disk"
          value={sizesLate ? "sizes loading" : formatBytes(c.sizeRootFs)}
          sub={sizesLate ? "Docker df is still counting" : `writable ${formatBytes(c.sizeRw)}`}
          dim={sizesLate}
        />
        <Cell label="pids" value={row ? String(row.pids) : "no data"} />
        <Cell label="Net rx / tx" value={row ? `${formatRate(row.rxRate)} / ${formatRate(row.txRate)}` : "no data"} />
      </div>
      <div className="flex items-baseline gap-2 min-w-0 my-3">
        <span className="microlabel shrink-0">image</span>
        <span className="font-mono text-xs text-ink-dim truncate" title={c.image}>
          {c.image}
        </span>
      </div>
      {widgetFields && widgetFields.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
          {widgetFields.slice(0, 4).map((f) => (
            <div key={f.label} className="flex items-baseline gap-1.5 min-w-0">
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
      <div className="wl-actions">
        <div className="wl-act1">
          <LifecycleActions state={c.state} name={c.name} lifecycle={lifecycle} />
          <Button
            size="sm"
            variant={compared ? "default" : "outline"}
            className="wl-compare md:h-8"
            aria-pressed={compared}
            disabled={!compared && compareFull}
            title={!compared && compareFull ? "4 is the most a chart stays readable" : undefined}
            onClick={() => onCompare(c.name)}
          >
            <GitCompare size={12} aria-hidden />
            <span className="truncate">{compared ? "Comparing" : "Compare"}</span>
          </Button>
        </div>
        {/* Row 2: PR5 adds Delete image… here as the first cell. */}
        <div className="wl-act2">
          <Link href={`/resources?metric=all&q=${encodeURIComponent(c.name)}`} className={link}>
            <List size={12} aria-hidden />
            <span className="truncate">Processes</span>
          </Link>
          <Link href={`/containers/${c.id.slice(0, 12)}`} className={link}>
            <span className="truncate">Details</span>
            <ExternalLink size={11} aria-hidden />
          </Link>
        </div>
      </div>
      <LifecycleError lifecycle={lifecycle} className="mt-2" />
    </div>
  );
}

interface Committed {
  split: WatchSplit;
  scale: number;
  cap: number;
}

export interface WatchlistProps {
  kind: "cpu" | "mem";
  containers: ResourceContainer[];
  /** useResources().data is present. */
  hasData: boolean;
  error: unknown;
  latest: TelemetrySample | undefined;
  samples: TelemetrySample[];
  stale: boolean;
  compare: string[];
  slots: ReadonlyMap<string, number>;
  onToggleCompare: (name: string) => void;
  widgetFieldsOf: (name: string) => WidgetField[] | undefined;
  /** Refetch /api/resources (after a lifecycle call, a create, or Retry now). */
  onChanged: () => void;
}

const COMPARE_MAX = 4;

export function Watchlist(p: WatchlistProps) {
  const { kind, containers, latest, samples, stale, compare, slots } = p;
  const isCpu = kind === "cpu";
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [folds, setFolds] = useState({ quiet: false, stopped: false });
  const [creating, setCreating] = useState(false);
  const [bump, setBump] = useState(0);
  const held = hover || focusIn || openId != null || stale;
  // An open container that left the list would hold the order for good.
  useEffect(() => {
    if (openId && !containers.some((c) => c.id === openId)) setOpenId(null);
  }, [openId, containers]);

  const rankerRef = useRef<Ranker | null>(null);
  rankerRef.current ??= createRanker();
  const ranker = rankerRef.current;
  const committed = useRef<Committed | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const register = useCallback((key: string, el: HTMLElement | null) => {
    if (el) itemRefs.current.set(key, el);
    else itemRefs.current.delete(key);
  }, []);

  const loading = !p.error && (!p.hasData || !latest);
  const rows = latest?.containers;
  const valueOf = (id: string) => {
    const r = rows?.[id];
    return r ? (isCpu ? r.cpuPct : r.memBytes) : null;
  };

  // Offer the order only once real data exists, so the first offer commits the real ranking.
  if (!p.error && p.hasData && latest) {
    const split = splitWatch(
      containers.map((c) => ({ id: c.id, name: c.name, running: c.state === "running", value: valueOf(c.id) })),
      kind,
    );
    const ids = [...split.watch, "\0quiet", ...split.quiet, "\0stopped", ...split.stopped];
    if (ranker.offer(ids, Date.now(), held) || !committed.current) {
      const top = Math.max(0, ...split.watch.map((id) => valueOf(id) ?? 0));
      const quietMax = Math.max(0, ...split.quiet.map((id) => valueOf(id) ?? 0));
      committed.current = { split, scale: snapScale(top, isCpu ? CPU_STEPS : MEM_STEPS), cap: quietCap(kind, quietMax) };
    }
  }

  const C = loading || p.error ? null : committed.current;
  const byId = new Map(containers.map((c) => [c.id, c]));
  const shown = (ids: string[]) => ids.filter((id) => byId.has(id));
  const watch = C ? shown(C.split.watch) : [];
  const quiet = C ? shown(C.split.quiet) : [];
  const stopped = C ? shown(C.split.stopped) : [];

  // The visible items in DOM (and rank) order; folds hold their rows only while open.
  const items: { key: string; fold?: "quiet" | "stopped"; group?: Group }[] = [
    ...watch.map((key) => ({ key, group: "watch" as const })),
    ...(quiet.length ? [{ key: "fold:quiet", fold: "quiet" as const }] : []),
    ...(folds.quiet ? quiet.map((key) => ({ key, group: "quiet" as const })) : []),
    ...(stopped.length ? [{ key: "fold:stopped", fold: "stopped" as const }] : []),
    ...(folds.stopped ? stopped.map((key) => ({ key, group: "stopped" as const })) : []),
  ];
  const visibleKey = items.map((i) => i.key).join("|");

  // The ONLY place layout is read: heights are measured here, on a commit, an open or a fold. Never on a tick.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const els = visibleKey ? visibleKey.split("|").map((k) => itemRefs.current.get(k)) : [];
    const heights = els.map((el) => el?.offsetHeight ?? 0);
    let y = 0;
    els.forEach((el, i) => {
      if (el) {
        const prev = el.dataset.y;
        el.style.transform = `translateY(${y}px)`;
        if (prev == null) el.dataset.new = "1";
        else delete el.dataset.new;
        if (prev != null && Number(prev) !== y && reduce) el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 240 });
        el.dataset.y = String(y);
      }
      y += heights[i];
    });
    box.style.height = `${y}px`;
  }, [visibleKey, openId, bump]);

  // Re-place rows when the list width changes (breakpoint) or the open detail changes height (an error line,
  // widget fields arriving). Resize events only; never per tick.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let lastW = box.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = box.clientWidth;
      if (w !== lastW) {
        lastW = w;
        setBump((b) => b + 1);
      }
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [items.length > 0]);
  useLayoutEffect(() => {
    const el = openId ? itemRefs.current.get(openId) : undefined;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) first = false;
      else setBump((b) => b + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [openId]);

  const toggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);
  const compareFull = compare.length >= COMPARE_MAX;
  const runningCount = watch.length + quiet.length;
  const scale = C?.scale ?? 1;
  const showHeld = held && ranker.pending;

  const countText = loading
    ? ""
    : p.error
      ? "unavailable"
      : containers.length === 0
        ? "0 containers"
        : `${watch.length} of ${runningCount} running${stopped.length ? ` · ${stopped.length} stopped or no data` : ""}`;
  const scaleText = !C
    ? ""
    : isCpu
      ? `scale 0–${C.scale}% of box`
      : `scale 0–${formatBytes(C.scale)}`;

  const quietLabel = C
    ? isCpu && C.cap <= QUIET_CPU
      ? `Quiet · ${quiet.length} running under ${QUIET_CPU}%`
      : `The other ${quiet.length} · each under ${isCpu ? `${C.cap}%` : formatBytes(C.cap, 0)}`
    : "";

  const create = (
    <Button size="sm" className="wl-create md:h-8" onClick={() => setCreating(true)}>
      <Plus size={12} aria-hidden /> New container
    </Button>
  );

  let body: React.ReactNode;
  if (p.error) {
    const err = p.error;
    const status = err instanceof ApiError ? err.status : "no response";
    const msg = err instanceof Error ? err.message : "";
    body = (
      <div role="alert" className="px-4 py-8 max-w-[34rem]">
        <h3 className="text-sm font-semibold mb-1.5">Docker did not answer</h3>
        <p className="text-xs leading-relaxed text-ink-dim mb-4">
          <span className="font-mono">{`GET /api/resources → ${status} ${msg}`}</span>. Nothing is listed rather than a guess.
          Retrying every 10 s; the box band above is live from the host stream.
        </p>
        <Button size="sm" variant="outline" onClick={() => p.onChanged()}>
          <RotateCw size={12} aria-hidden /> Retry now
        </Button>
      </div>
    );
  } else if (loading) {
    body = (
      <>
        <p className="microlabel px-4 pt-3 pb-1 m-0">reading Docker…</p>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="wl-skel" aria-hidden>
            <div className="h-2 flex-1 rounded-full bg-panel-2 motion-safe:animate-pulse" />
          </div>
        ))}
      </>
    );
  } else if (containers.length === 0) {
    body = (
      <div className="px-4 py-8 max-w-[34rem]">
        <h3 className="text-sm font-semibold mb-1.5">No containers on this box</h3>
        <p className="text-xs leading-relaxed text-ink-dim mb-4">
          Docker answered with an empty list. Containers you create or start appear here, busiest first.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={12} aria-hidden /> New container
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        {isCpu && watch.length === 0 && (
          <p className="wl-note text-xs text-ink-dim m-0">
            Nothing is above {QUIET_CPU}% of the box right now. Quiet is normal here.
          </p>
        )}
        <div ref={boxRef} className="wl-rows" role="list">
          {items.map((it, i) => {
            if (it.fold) {
              const f = it.fold;
              return (
                <div
                  key={it.key}
                  ref={(el) => register(it.key, el)}
                  role="listitem"
                  className="wl-item"
                  data-row-id={it.key}
                  data-rank="fold"
                >
                  <button
                    type="button"
                    className="wl-fold"
                    aria-expanded={folds[f]}
                    onClick={() => setFolds((s) => ({ ...s, [f]: !s[f] }))}
                  >
                    <ChevronDown size={12} className="wl-fold-chev" aria-hidden />
                    <span>{f === "quiet" ? quietLabel : `Stopped / no data · ${stopped.length}`}</span>
                  </button>
                </div>
              );
            }
            const c = byId.get(it.key) as ResourceContainer;
            const row = rows?.[c.id];
            const ci = compare.indexOf(c.name);
            return (
              <WatchRow
                key={c.id}
                c={c}
                kind={kind}
                group={it.group as Group}
                rank={i + 1}
                row={row}
                scale={scale}
                spark={row ? seriesFor(samples, c.id, kind) : null}
                open={openId === c.id}
                slot={ci >= 0 ? SERIES_SLOTS[slots.get(c.name) ?? 1] : null}
                compared={ci >= 0}
                compareFull={compareFull}
                widgetFields={p.widgetFieldsOf(c.name)}
                onToggle={toggle}
                onCompare={p.onToggleCompare}
                onChanged={p.onChanged}
                register={register}
              />
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
    <section
      className="panel wl-panel"
      aria-label={isCpu ? "Busiest containers by CPU" : "Containers by memory"}
      data-stale={stale || undefined}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocusIn(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
      }}
    >
      <div className="wl-head">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-sm font-semibold tracking-tight m-0">{isCpu ? "Busiest" : "Heaviest"}</h2>
          <span className="text-2xs text-ink-dim truncate">{countText}</span>
        </div>
        <div className="wl-meta">
          <span className={cn("microlabel !text-warn order-2 md:order-none", !showHeld && "invisible")}>order held</span>
          <span className="microlabel order-1 md:order-none">{scaleText}</span>
        </div>
        {create}
      </div>
      {body}
    </section>
    {creating && (
      <CreateContainerDialog
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          p.onChanged();
        }}
      />
    )}
    </>
  );
}
