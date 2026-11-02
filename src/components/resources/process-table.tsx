"use client";

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, formatPercent, formatRate } from "@/lib/format";
import { useProcesses, type ProcessRow } from "@/lib/client";
import { buildGroups, filterGroups, processMatches, rankedIds, topProcs, type Group, type GroupSort } from "@/lib/process-groups";
import { createRanker, type Ranker } from "@/lib/watchlist";
import { Input, Select } from "@/components/ui/input";
import { SegmentButton } from "@/components/ui/segment-button";

/** Same data, two subjects. "containers" (the default) is the grouped, calmly ranked list:
 *  one row per container plus "other", which answers "which app is hot". "processes" is the
 *  flat per-pid table, kept for "which pid is hot". */
type View = "processes" | "containers";

type SortKey = "name" | "pid" | "cpu" | "mem" | "io" | "threads";
type SortDir = "asc" | "desc";

/** Clicking a fresh column should land on the direction that answers the question
 *  the column exists for: biggest-first for magnitudes, A-Z for a name. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: "asc",
  pid: "asc",
  cpu: "desc",
  mem: "desc",
  io: "desc",
  threads: "desc",
};

/** The flat card list has no clickable column headers, so it needs its own compact way to change sort. */
const MOBILE_SORT_OPTIONS: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: "name", dir: "asc", label: "Name (A–Z)" },
  { key: "name", dir: "desc", label: "Name (Z–A)" },
  { key: "cpu", dir: "desc", label: "CPU (high → low)" },
  { key: "cpu", dir: "asc", label: "CPU (low → high)" },
  { key: "mem", dir: "desc", label: "Mem (high → low)" },
  { key: "mem", dir: "asc", label: "Mem (low → high)" },
  { key: "io", dir: "desc", label: "Disk I/O (high → low)" },
  { key: "pid", dir: "asc", label: "PID (low → high)" },
];

/** How many process rows the flat view renders before the reader asks for more. The box runs
 *  ~476 processes; mounting all of them at a 2s poll cadence is jank for no gain. Search bypasses this. */
const PAGE = 40;

/** One flat row. A container's processes all carry that container's single cgroup figure. */
interface Row {
  key: string;
  label: string;
  pid: number;
  cpuPct: number | null;
  rssBytes: number;
  ioRate: number | null;
  threads: number;
  process: ProcessRow;
  containerId: string | null;
}

function numericValue(r: Row, key: SortKey): number | null {
  switch (key) {
    case "pid":
      return r.pid;
    case "cpu":
      return r.cpuPct;
    case "mem":
      return r.rssBytes;
    case "io":
      return r.ioRate;
    case "threads":
      return r.threads;
    case "name":
      return null;
  }
}

/**
 * Nulls sort last in BOTH directions — deliberately not symmetric. A null here
 * means "not measured" (a process too new to have a CPU delta, or a host process
 * with no container cgroup to read I/O from), and an ascending sort that opened
 * with 300 unmeasured rows would bury the answer the reader came for.
 */
function cmpNum(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "desc" ? b - a : a - b;
}

function sortRows(rows: Row[], key: SortKey, dir: SortDir): Row[] {
  const sorted = [...rows];
  if (key === "name") {
    sorted.sort((a, b) => {
      const c = a.label.localeCompare(b.label);
      return dir === "asc" ? c : -c;
    });
  } else {
    sorted.sort(
      (a, b) =>
        cmpNum(numericValue(a, key), numericValue(b, key), dir) ||
        // Sorting by I/O groups a container's processes together, since they all carry its one
        // cgroup figure. Break that tie on CPU so the container's busiest process leads its group.
        (key === "io" ? cmpNum(a.cpuPct, b.cpuPct, "desc") : 0) ||
        // Stable last resort, so equal values hold their order between polls.
        a.pid - b.pid ||
        a.label.localeCompare(b.label),
    );
  }
  return sorted;
}

/** Kernel threads have no cmdline; ps renders them bracketed and every admin reads that convention instantly. */
function displayName(p: ProcessRow): string {
  return p.isKernel ? `[${p.comm}]` : p.comm;
}

function processRows(processes: ProcessRow[]): Row[] {
  return processes.map((p) => ({
    key: String(p.pid),
    label: displayName(p),
    pid: p.pid,
    cpuPct: p.cpuPct,
    rssBytes: p.rssBytes,
    ioRate: p.cgroupIoRate,
    threads: p.threads,
    process: p,
    containerId: p.containerId,
  }));
}

function SortHeader({
  label,
  sublabel,
  columnKey,
  sort,
  onSort,
  className,
  title,
}: {
  label: string;
  sublabel?: string;
  columnKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  className?: string;
  title?: string;
}) {
  const active = sort.key === columnKey;
  return (
    <th
      scope="col"
      className={cn("px-2 py-1.5 font-normal", className)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        title={title ?? `Sort by ${label.toLowerCase()}`}
        className={cn(
          "group relative inline-flex items-baseline gap-1 cursor-pointer rounded transition-colors after:absolute after:-inset-y-[9px] after:-inset-x-1 after:content-['']",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/60",
          active ? "text-accent" : "text-ink-faint hover:text-ink-dim",
        )}
      >
        <span className="microlabel !text-current">{label}</span>
        {sublabel && <span className="microlabel !text-current !tracking-normal opacity-60">{sublabel}</span>}
        <ChevronDown
          size={11}
          aria-hidden
          className={cn(
            "shrink-0 self-center transition-[transform,opacity] duration-200",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-40",
            active && sort.dir === "asc" && "rotate-180",
          )}
        />
      </button>
    </th>
  );
}

/**
 * One control, two subjects. Both words stay visible with the active one lit, so
 * the current state and the alternative read at a glance. The whole thing is one
 * button, so the touch target is the full width rather than the 36px track.
 */
function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const containers = view === "containers";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={containers}
      aria-label="Group rows by container"
      title={containers ? "Showing one row per container — switch to processes" : "Showing one row per process — switch to containers"}
      onClick={() => onChange(containers ? "processes" : "containers")}
      className="group flex items-center gap-2 h-11 md:h-8 px-1 shrink-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/60"
    >
      <span aria-hidden className={cn("microlabel transition-colors", !containers && "!text-accent")}>
        PROCESSES
      </span>
      <span
        aria-hidden
        className={cn(
          "relative h-4 w-8 rounded-full border transition-colors shrink-0",
          "bg-panel-2 border-line group-hover:border-line-bright",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-accent",
            "transition-[left] duration-200 ease-out",
            containers ? "left-[1.0625rem]" : "left-[0.1875rem]",
          )}
        />
      </span>
      <span aria-hidden className={cn("microlabel transition-colors", containers && "!text-accent")}>
        CONTAINERS
      </span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => (
        <tr key={i} className="border-b border-line/40 last:border-0">
          <td className="px-2 py-2" colSpan={6}>
            <div
              className="h-3 rounded bg-panel-2 animate-pulse"
              // Descending widths read as a ranked list settling in, rather than
              // ten identical bars that look like a stuck loader.
              style={{ width: `${68 - i * 4}%`, animationDelay: `${i * 60}ms` }}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Same descending-width idiom as SkeletonRows, in the card list's own shape. */
function SkeletonCards() {
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="px-3 py-3 border-b border-line/40 last:border-0">
          <div
            className="h-3 rounded bg-panel-2 animate-pulse"
            style={{ width: `${68 - i * 4}%`, animationDelay: `${i * 60}ms` }}
          />
        </div>
      ))}
    </>
  );
}

/** D = uninterruptible sleep, i.e. blocked in the kernel, nearly always on I/O.
 *  Z = a zombie nobody reaped. Both are worth a glance; R/S are unremarkable. */
function stateTone(state: string): { className: string; title: string } {
  if (state === "R") return { className: "dot-running", title: "running" };
  if (state === "D") return { className: "dot-restarting", title: "uninterruptible sleep — blocked, usually on disk" };
  if (state === "Z") return { className: "dot-dead", title: "zombie — exited, not reaped by its parent" };
  if (state === "T" || state === "t") return { className: "dot-stopped", title: "stopped" };
  return { className: "dot-stopped", title: "sleeping" };
}

/** Shared per-row derived state for the flat table row and card: tone dot, magnitude bar, "same container as above" collapse. */
function rowMeta(r: Row, i: number, visible: Row[], barMax: number, sort: { key: SortKey; dir: SortDir }) {
  const p = r.process;
  const tone = stateTone(p.state);
  const barValue = barMax > 0 ? numericValue(r, sort.key) : null;
  const pct = barValue == null || barMax <= 0 ? 0 : Math.min(100, (barValue / barMax) * 100);
  // Six postgres processes in one container all carry that container's single I/O figure. Printed six
  // times it reads as six independent consumers, which is a real misreading no header caveat prevents.
  const ioRepeat = r.ioRate != null && r.containerId != null && i > 0 && visible[i - 1].containerId === r.containerId;
  return { p, tone, pct, ioRepeat };
}

const ioTitle = (r: Row, ioRepeat: boolean) =>
  r.ioRate == null
    ? r.containerId
      ? "this container's cgroup reported no readable io.stat"
      : "not in a container — per-process disk I/O is not readable without root"
    : ioRepeat
      ? `same ${r.process.containerName ?? "container"} cgroup as the row above — ${formatRate(r.ioRate)} for the container in total, not per process`
      : `${r.process.containerName ?? "container"} cgroup total, shared by all its processes`;

const cpuText = (v: number) => formatPercent(v, v < 0.1 ? 2 : 1);

type PGroup = Group<ProcessRow>;
type Item = { key: string; gid: string; group: PGroup } | { key: string; gid: string; p: ProcessRow };

export function ProcessTable({ initialQuery, stale = false }: { initialQuery?: string; stale?: boolean } = {}) {
  const { data, isLoading, error } = useProcesses(2000);
  // Containers by default: "which app is eating the box" is the question actually being asked.
  const [view, setView] = useState<View>("containers");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cpu", dir: "desc" });
  const [gsort, setGsort] = useState<GroupSort>("cpu");
  // Seeds once from a `?q=` deep link (see resources/page.tsx) — a lazy useState initializer, not an
  // effect, so it never overwrites what the owner types afterward.
  const [query, setQuery] = useState(initialQuery ?? "");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [bump, setBump] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const register = useCallback((key: string, el: HTMLElement | null) => {
    if (el) itemRefs.current.set(key, el);
    else itemRefs.current.delete(key);
  }, []);
  // A `?q=` landing opens up to 3 matching groups, once, when the first order commits.
  const autoOpen = useRef(!!initialQuery?.trim());

  // The 2s poll re-runs grouping+filter over ~476 rows; deferring keeps typing responsive.
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim();
  const searching = q.length > 0;

  const processes = useMemo(() => data?.processes ?? [], [data]);
  const allGroups = useMemo(() => buildGroups(processes), [processes]);
  const groups = useMemo(() => filterGroups(allGroups, q), [allGroups, q]);

  function handleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: DEFAULT_DIR[key] }));
  }
  function changeQuery(v: string) {
    setQuery(v);
    setOpen(new Set()); // a new filter starts closed: the old open groups may not match
    autoOpen.current = false;
  }

  // "/" focuses the filter, as in a terminal pager.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- grouped view: the calm ranker (shape brief s3) ----
  const held = hover || focusIn || open.size > 0 || stale;
  const rk = useRef<{ key: string; ranker: Ranker; procs: Map<string, number[]> } | null>(null);
  const rkKey = `${gsort}|${q.toLowerCase()}`;
  if (!rk.current || rk.current.key !== rkKey) rk.current = { key: rkKey, ranker: createRanker(), procs: new Map() };
  const { ranker, procs: procCache } = rk.current;

  const byId = new Map(groups.map((g) => [g.id, g]));
  if (data && !data.error) {
    // The first offer of a new sort or filter always commits, so results rank at once even while focus holds the list.
    if (ranker.offer(rankedIds(groups, gsort), Date.now(), held)) procCache.clear();
  }
  const order = (ranker.order ?? []).filter((id) => byId.has(id));
  for (const k of procCache.keys()) if (!open.has(k)) procCache.delete(k);

  const items: Item[] = [];
  for (const id of order) {
    const g = byId.get(id) as PGroup;
    items.push({ key: id, gid: id, group: g });
    if (!open.has(id)) continue;
    let pids = procCache.get(id);
    if (!pids) {
      pids = topProcs(g, q, gsort).map((p) => p.pid);
      procCache.set(id, pids);
    }
    for (const pid of pids) {
      const p = g.procs.find((x) => x.pid === pid);
      if (p) items.push({ key: `${id}:${pid}`, gid: id, p });
    }
  }
  const visibleKey = items.map((i) => i.key).join("|");

  useEffect(() => {
    if (!autoOpen.current || order.length === 0) return;
    autoOpen.current = false;
    setOpen(new Set(order.slice(0, 3)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.length]);

  // The ONLY place layout is read: heights are measured here, on a commit, an open or a resize. Never on a tick.
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
  }, [visibleKey, bump, view]);

  // Re-place rows when the list width changes (breakpoint). Resize events only; never per tick.
  const hasBox = view === "containers" && items.length > 0;
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
  }, [hasBox]);

  const toggle = useCallback(
    (id: string) =>
      setOpen((cur) => {
        const n = new Set(cur);
        if (!n.delete(id)) n.add(id);
        return n;
      }),
    [],
  );

  // ---- flat view ----
  const flatRows = useMemo(() => {
    const matched = searching ? processes.filter((p) => processMatches(p, q.toLowerCase())) : processes;
    return sortRows(processRows(matched), sort.key, sort.dir);
  }, [processes, searching, q, sort.key, sort.dir]);
  const paginate = view === "processes" && !searching;
  const visible = paginate ? flatRows.slice(0, limit) : flatRows;
  // Bar scale from the CURRENTLY SORTED metric, so the bar always encodes what the reader just asked to rank by.
  const barMax = useMemo(() => {
    if (sort.key === "name" || sort.key === "pid") return 0;
    let m = 0;
    for (const r of flatRows) {
      const v = numericValue(r, sort.key);
      if (v != null && v > m) m = v;
    }
    return m;
  }, [flatRows, sort.key]);

  const emptyContent = searching ? (
    <>
      <p className="text-ink-dim text-sm">Nothing matches</p>
      <p className="text-ink-faint text-xs mt-1">
        No container, process name, command line or pid contains <span className="font-mono text-ink">&ldquo;{q}&rdquo;</span>.
      </p>
      <button type="button" onClick={() => changeQuery("")} className="text-xs text-accent hover:underline mt-2.5 cursor-pointer">
        Clear filter
      </button>
    </>
  ) : (
    <p className="text-ink-faint text-sm">No processes reported.</p>
  );

  if (error) {
    return (
      <div className="panel px-4 py-6">
        <div className="microlabel !text-warn/80">process scan failed</div>
        <p className="text-ink-dim text-xs mt-1.5">
          {error instanceof Error ? error.message : "the /api/processes endpoint did not respond"}
        </p>
      </div>
    );
  }

  if (data?.error) {
    return (
      <div className="panel px-4 py-6">
        <div className="microlabel !text-warn/80">host processes unreadable</div>
        <p className="text-ink-dim text-xs mt-1.5">{data.error}</p>
        <p className="text-ink-faint text-[0.68rem] mt-1">
          This view reads <span className="font-mono">/host/proc</span>, which the dashboard container mounts read-only.
        </p>
      </div>
    );
  }

  const grouped = view === "containers";
  // Not aria-live: this count moves on every 2s poll, so a live region would re-announce constantly.
  const countText = !data
    ? ""
    : grouped
      ? searching
        ? `${groups.length} groups match "${q}"`
        : `${processes.length} processes · ${allGroups.length} groups${data.skipped > 0 ? ` · ${data.skipped} vanished mid-scan` : ""}`
      : searching
        ? `${flatRows.length} of ${processes.length}`
        : `${processes.length} processes${data.skipped > 0 ? ` · ${data.skipped} vanished mid-scan` : ""}`;

  return (
    <div className="space-y-2">
      <p className="text-ink-faint text-[0.68rem] leading-relaxed m-0 max-w-[46rem]">
        {grouped ? (
          <>
            Every process on the host, grouped by the container that owns it. CPU is a share of the whole box; disk i/o is
            per container (Linux does not expose it per process).
          </>
        ) : (
          <>
            CPU and memory are measured per process. <span className="text-ink-dim">Disk I/O is per container</span> — it
            is the cgroup&apos;s combined read+write rate, printed once per container with{" "}
            <span className="font-mono text-ink-dim">↳</span> on its other processes, because per-process I/O counters are
            readable only by root and this dashboard runs unprivileged.
          </>
        )}
      </p>

      <section
        className="panel pt-panel"
        aria-label={grouped ? "Processes by container" : "All processes"}
        data-stale={stale || undefined}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setFocusIn(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
        }}
      >
        <div className="pt-head">
          <div className="pt-title">
            <h2 className="text-sm font-semibold tracking-tight m-0">Processes</h2>
            <span className="text-2xs text-ink-dim truncate">{countText}</span>
          </div>
          {grouped && (
            <span className={cn("microlabel !text-warn", !(held && ranker.pending) && "invisible")}>order held</span>
          )}
          <div className="pt-filter">
            <Search size={13} className="pt-search" aria-hidden />
            <Input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder="Filter by name"
              aria-label="Filter by container, process, command or pid"
              className="pt-input"
            />
            {!query && (
              <kbd className="pt-kbd" aria-hidden>
                /
              </kbd>
            )}
            {query && (
              <button type="button" onClick={() => changeQuery("")} aria-label="Clear filter" className="pt-clear">
                <X size={13} aria-hidden />
              </button>
            )}
          </div>
          <div className="pt-ctl">
            {grouped ? (
              <div className="flex gap-1 [&>button]:min-w-11" role="group" aria-label="Sort groups by">
                <SegmentButton active={gsort === "cpu"} onClick={() => setGsort("cpu")}>
                  CPU
                </SegmentButton>
                <SegmentButton active={gsort === "mem"} onClick={() => setGsort("mem")}>
                  MEM
                </SegmentButton>
              </div>
            ) : (
              /* No column headers to click on a phone, so sorting moves to a compact Select. */
              <div className="md:hidden flex-1 min-w-0">
                <Select
                  aria-label="Sort processes"
                  value={`${sort.key}-${sort.dir}`}
                  onChange={(e) => {
                    const [key, dir] = e.target.value.split("-") as [SortKey, SortDir];
                    setSort({ key, dir });
                  }}
                >
                  {MOBILE_SORT_OPTIONS.map((opt) => (
                    <option key={`${opt.key}-${opt.dir}`} value={`${opt.key}-${opt.dir}`}>
                      Sort: {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <ViewSwitch view={view} onChange={setView} />
          </div>
        </div>

        {grouped ? (
          <>
            <div className="pt-colhead" aria-hidden>
              <span className="pt-ch-name">container / process</span>
              <span className="pt-ch-procs">procs</span>
              <span className="pt-ch-cpu">cpu</span>
              <span className="pt-ch-mem" title="the sum of member processes' RSS, which counts shared pages once per process">
                mem
              </span>
              <span className="pt-ch-io">disk i/o</span>
              <span className="pt-ch-thr">thr</span>
            </div>
            {isLoading && !data ? (
              <>
                <p className="microlabel px-4 pt-3 pb-1 m-0">reading /proc…</p>
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="pt-skel" aria-hidden>
                    <div className="h-2 flex-1 rounded-full bg-panel-2 motion-safe:animate-pulse" style={{ maxWidth: `${68 - i * 4}%` }} />
                  </div>
                ))}
              </>
            ) : data && groups.length === 0 ? (
              <div className="px-4 py-10 text-center">{emptyContent}</div>
            ) : (
              <div ref={boxRef} className="pt-rows" role="list">
                {items.map((it, i) =>
                  "group" in it ? (
                    <GroupRow key={it.key} g={it.group} rank={i + 1} open={open.has(it.gid)} onToggle={toggle} register={register} />
                  ) : (
                    <ProcRow key={it.key} id={it.key} p={it.p} rank={i + 1} register={register} />
                  ),
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Identical column geometry at every width from md; below it the card list takes over, because
                fixed column widths this narrow overlap the header labels on a phone. */}
            <table className="hidden md:table w-full table-fixed border-collapse text-left">
              <colgroup>
                <col />
                <col className="w-14 lg:w-16" />
                <col className="w-16 sm:w-20" />
                <col className="w-[4.5rem] sm:w-24" />
                <col className="w-24" />
                <col className="w-16" />
              </colgroup>
              <thead className="sticky top-0 z-(--z-sticky) bg-panel-2 border-b border-line">
                <tr>
                  <SortHeader label="Process" columnKey="name" sort={sort} onSort={handleSort} />
                  <SortHeader label="PID" columnKey="pid" sort={sort} onSort={handleSort} className="hidden lg:table-cell text-right" />
                  <SortHeader
                    label="CPU"
                    columnKey="cpu"
                    sort={sort}
                    onSort={handleSort}
                    className="text-right"
                    title="Sort by CPU — share of the whole server, the same scale as the band"
                  />
                  <SortHeader label="Mem" columnKey="mem" sort={sort} onSort={handleSort} className="text-right" title="Sort by resident memory" />
                  {/* This figure is the CONTAINER's, not the process's, and the header is the only place that can say so. */}
                  <SortHeader
                    label="Disk I/O"
                    sublabel="/ container"
                    columnKey="io"
                    sort={sort}
                    onSort={handleSort}
                    className="hidden sm:table-cell text-right"
                    title="Sort by disk I/O — measured per container cgroup, shared by every process inside it"
                  />
                  <SortHeader label="Thr" columnKey="threads" sort={sort} onSort={handleSort} className="hidden lg:table-cell text-right" />
                </tr>
              </thead>
              <tbody>
                {isLoading && !data && <SkeletonRows />}

                {data && visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center">
                      {emptyContent}
                    </td>
                  </tr>
                )}

                {visible.map((r, i) => {
                  const { p, tone, pct, ioRepeat } = rowMeta(r, i, visible, barMax, sort);

                  return (
                    <tr key={r.key} className="border-b border-line/40 last:border-0 hover:bg-panel-2/60 align-middle">
                      <td className="px-2 py-1.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn("dot", tone.className)} title={tone.title} />
                          <span className="font-mono text-[0.8rem] truncate text-ink" title={p.cmdline ?? r.label}>
                            {r.label}
                          </span>
                          {p.containerName && (
                            <span className="microlabel truncate shrink-0 max-w-[7rem] hidden sm:inline" title={`container: ${p.containerName}`}>
                              {p.containerName}
                            </span>
                          )}
                        </div>
                        {/* Magnitude bar for the active sort key. Always present, so changing sort re-scales it rather than shifting the row. */}
                        <div className="mt-1 h-0.5 rounded-full bg-panel-2 overflow-hidden">
                          {pct > 0 && (
                            <div
                              className="h-full rounded-full transition-[width] duration-300 ease-out"
                              style={{ width: `${pct}%`, background: "var(--color-accent-dim)" }}
                            />
                          )}
                        </div>
                        {/* Everything the narrow layout drops from its own column lives here. */}
                        <div className="flex items-baseline gap-2 mt-0.5 lg:hidden">
                          <span className="microlabel shrink-0">{r.pid}</span>
                          <span className="microlabel sm:hidden shrink-0" title="disk I/O of this container's cgroup">
                            io {r.ioRate != null ? formatRate(r.ioRate) : "—"}
                          </span>
                          {p.containerName && <span className="microlabel truncate sm:hidden">{p.containerName}</span>}
                        </div>
                      </td>

                      <td className="px-2 py-1.5 text-right hidden lg:table-cell font-mono text-[0.72rem] text-ink-dim">{r.pid}</td>

                      <td
                        className="px-2 py-1.5 text-right font-mono text-[0.75rem] text-ink"
                        title={
                          r.cpuPct == null
                            ? "not measured yet — a CPU figure needs two samples, and this appeared after the last one"
                            : undefined
                        }
                      >
                        {r.cpuPct == null ? <span className="text-ink-faint">—</span> : formatPercent(r.cpuPct, 1)}
                      </td>

                      <td className="px-2 py-1.5 text-right font-mono text-[0.75rem] text-ink">{formatBytes(r.rssBytes)}</td>

                      <td className="px-2 py-1.5 text-right hidden sm:table-cell font-mono text-[0.75rem]" title={ioTitle(r, ioRepeat)}>
                        {r.ioRate == null ? (
                          <span className="text-ink-faint">—</span>
                        ) : ioRepeat ? (
                          <span className="text-ink-faint" aria-label="same container as the row above">
                            ↳
                          </span>
                        ) : (
                          // The container's number, not the pid's, so it stays quieter than the figures that belong to the process.
                          <span className="text-ink-dim">{formatRate(r.ioRate)}</span>
                        )}
                      </td>

                      <td className="px-2 py-1.5 text-right hidden lg:table-cell font-mono text-[0.72rem] text-ink-dim">{r.threads}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Same rows as the table, one card per row. Thread count is dropped: it does not earn a line on a screen this narrow. */}
            <div className="md:hidden divide-y divide-line/40">
              {isLoading && !data && <SkeletonCards />}

              {data && visible.length === 0 && <div className="px-3 py-10 text-center">{emptyContent}</div>}

              {visible.map((r, i) => {
                const { p, tone, pct, ioRepeat } = rowMeta(r, i, visible, barMax, sort);

                return (
                  <div key={r.key} className="px-3 py-2.5 min-h-11">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("dot shrink-0", tone.className)} title={tone.title} />
                      <span className="font-mono text-sm truncate text-ink" title={p.cmdline ?? r.label}>
                        {r.label}
                      </span>
                      <span className="microlabel shrink-0 ml-auto">{`pid ${r.pid}`}</span>
                    </div>

                    {p.containerName && (
                      <div className="mt-0.5">
                        <span className="microlabel truncate" title={`container: ${p.containerName}`}>
                          {p.containerName}
                        </span>
                      </div>
                    )}

                    <div className="mt-1.5 h-0.5 rounded-full bg-panel-2 overflow-hidden">
                      {pct > 0 && (
                        <div
                          className="h-full rounded-full transition-[width] duration-300 ease-out"
                          style={{ width: `${pct}%`, background: "var(--color-accent-dim)" }}
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-4 mt-1.5">
                      <div>
                        <div className="microlabel">CPU</div>
                        <div
                          className="font-mono text-xs text-ink tabular-nums mt-0.5"
                          title={
                            r.cpuPct == null
                              ? "not measured yet — a CPU figure needs two samples, and this appeared after the last one"
                              : undefined
                          }
                        >
                          {r.cpuPct == null ? <span className="text-ink-faint">—</span> : formatPercent(r.cpuPct, 1)}
                        </div>
                      </div>
                      <div>
                        <div className="microlabel">Mem</div>
                        <div className="font-mono text-xs text-ink tabular-nums mt-0.5">{formatBytes(r.rssBytes)}</div>
                      </div>
                      <div>
                        <div className="microlabel">Disk I/O / container</div>
                        <div className="font-mono text-xs tabular-nums mt-0.5" title={ioTitle(r, ioRepeat)}>
                          {r.ioRate == null ? (
                            <span className="text-ink-faint">—</span>
                          ) : ioRepeat ? (
                            <span className="text-ink-faint" aria-label="same container as the row above">
                              ↳
                            </span>
                          ) : (
                            <span className="text-ink-dim">{formatRate(r.ioRate)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {paginate && flatRows.length > visible.length && (
              <div className="border-t border-line px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                <span className="microlabel">
                  showing top {visible.length} of {flatRows.length}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + PAGE)}
                    className="text-xs text-ink-dim hover:text-accent cursor-pointer min-h-11 md:min-h-8 inline-flex items-center"
                  >
                    Show {Math.min(PAGE, flatRows.length - visible.length)} more
                  </button>
                  <button
                    type="button"
                    onClick={() => setLimit(flatRows.length)}
                    className="text-xs text-ink-dim hover:text-accent cursor-pointer min-h-11 md:min-h-8 inline-flex items-center"
                  >
                    Show all
                  </button>
                </div>
              </div>
            )}
            {paginate && limit > PAGE && flatRows.length <= visible.length && (
              <div className="border-t border-line px-3 py-2">
                <button type="button" onClick={() => setLimit(PAGE)} className="text-xs text-ink-dim hover:text-accent cursor-pointer min-h-11 md:min-h-8 inline-flex items-center">
                  Collapse to top {PAGE}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function GroupRow({
  g,
  rank,
  open,
  onToggle,
  register,
}: {
  g: PGroup;
  rank: number;
  open: boolean;
  onToggle: (id: string) => void;
  register: (key: string, el: HTMLElement | null) => void;
}) {
  return (
    <div ref={(el) => register(g.id, el)} role="listitem" className="pt-item" data-row-id={g.id} data-rank={rank} data-open={open || undefined}>
      <button type="button" className="pt-grow" aria-expanded={open} onClick={() => onToggle(g.id)}>
        <span className={cn("dot pt-dot", g.other ? "dot-stopped" : "dot-running")} />
        <span className={cn("pt-name font-mono text-[0.8rem]", g.other ? "text-ink-dim" : "text-ink")} title={g.other ? `${g.procs.filter((p) => !p.isKernel).length} host processes and ${g.procs.filter((p) => p.isKernel).length} kernel threads, none of which belong to a container` : g.name}>
          {g.name}
        </span>
        <span className="pt-c pt-procs">
          {g.procs.length}
          <span className="pt-unit text-ink-faint"> proc{g.procs.length === 1 ? "" : "s"}</span>
        </span>
        <span
          className="pt-c pt-cpu text-ink"
          title={g.cpu == null ? "not measured yet — a CPU figure needs two samples, and these appeared after the last one" : undefined}
        >
          {g.cpu == null ? <span className="text-ink-faint">—</span> : cpuText(g.cpu)}
        </span>
        <span className="pt-c pt-mem text-ink">{formatBytes(g.mem)}</span>
        <span
          className="pt-c pt-io text-ink-dim"
          title={g.io == null ? "not attributable: no container cgroup" : "container-wide, not per process"}
        >
          {g.io == null ? <span className="text-ink-faint">—</span> : formatRate(g.io)}
        </span>
        <span className="pt-c pt-thr text-ink-dim">{g.threads}</span>
        <ChevronDown size={13} className="pt-chev" aria-hidden />
      </button>
    </div>
  );
}

function ProcRow({
  id,
  p,
  rank,
  register,
}: {
  id: string;
  p: ProcessRow;
  rank: number;
  register: (key: string, el: HTMLElement | null) => void;
}) {
  const cmd = p.cmdline ?? (p.isKernel ? "kernel thread" : "(no cmdline)");
  return (
    <div ref={(el) => register(id, el)} role="listitem" className="pt-item pt-proc" data-row-id={id} data-rank={rank}>
      <div className="pt-pin">
        <span className="pt-pid font-mono text-ink-faint">{p.pid}</span>
        <span className="pt-pname font-mono" title={p.cmdline ?? `[${p.comm}] kernel thread`}>
          <span className="text-ink">{displayName(p)}</span>
          <span className="pt-cmd text-ink-faint"> {cmd}</span>
        </span>
        <span className="pt-state font-mono text-ink-dim" title={stateTone(p.state).title}>
          {p.state}
        </span>
        <span
          className={cn("pt-c pt-pcpu", p.cpuPct == null ? "text-ink-faint" : "text-ink")}
          title={p.cpuPct == null ? "first sample: no delta yet (not idle)" : undefined}
        >
          {p.cpuPct == null ? "new" : cpuText(p.cpuPct)}
        </span>
        <span className="pt-c pt-pmem text-ink">{formatBytes(p.rssBytes)}</span>
        <span className="pt-c pt-pthr text-ink-dim">{p.threads}</span>
      </div>
    </div>
  );
}
