"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, formatPercent, formatRate } from "@/lib/format";
import { useProcesses, type ProcessRow } from "@/lib/client";

/** Sortable columns. "name" sorts a string; everything else sorts a number that
 *  may be null, and null always loses (see cmpNum). */
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

/** How many rows render before the reader asks for more. The box runs ~476
 *  processes; mounting all of them at a 2s poll cadence is jank for no gain,
 *  and the brief asks for TOP consumers. Search bypasses this entirely. */
const PAGE = 40;

function numericValue(p: ProcessRow, key: SortKey): number | null {
  switch (key) {
    case "pid":
      return p.pid;
    case "cpu":
      return p.cpuPct;
    case "mem":
      return p.rssBytes;
    case "io":
      return p.cgroupIoRate;
    case "threads":
      return p.threads;
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

function sortProcesses(rows: ProcessRow[], key: SortKey, dir: SortDir): ProcessRow[] {
  const sorted = [...rows];
  if (key === "name") {
    sorted.sort((a, b) => {
      const c = a.comm.localeCompare(b.comm);
      return dir === "asc" ? c : -c;
    });
  } else {
    sorted.sort(
      (a, b) =>
        cmpNum(numericValue(a, key), numericValue(b, key), dir) ||
        // Sorting by I/O groups a container's processes together, since they all
        // carry its one cgroup figure. Break that tie on CPU so the container's
        // busiest process leads its own group rather than whichever forked first.
        (key === "io" ? cmpNum(a.cpuPct, b.cpuPct, "desc") : 0) ||
        // pid last, so equal values (a wall of 0.0% CPU) hold a stable order
        // between polls instead of reshuffling every 2 seconds.
        a.pid - b.pid,
    );
  }
  return sorted;
}

function matches(p: ProcessRow, q: string): boolean {
  if (!q) return true;
  return (
    p.comm.toLowerCase().includes(q) ||
    String(p.pid).includes(q) ||
    (p.containerName?.toLowerCase().includes(q) ?? false) ||
    (p.cmdline?.toLowerCase().includes(q) ?? false)
  );
}

/** Kernel threads have no cmdline; ps renders them bracketed and every admin
 *  reads that convention instantly. */
function displayName(p: ProcessRow): string {
  return p.isKernel ? `[${p.comm}]` : p.comm;
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
          "group inline-flex items-baseline gap-1 cursor-pointer rounded transition-colors",
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

export function ProcessTable() {
  const { data, isLoading, error } = useProcesses(2000);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cpu", dir: "desc" });
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // The 2s poll re-runs filter+sort over ~476 rows; deferring keeps typing in the
  // search box responsive instead of queueing behind that work. Same reason the
  // treemap on this page defers its layout.
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  function handleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: DEFAULT_DIR[key] }));
  }

  const all = data?.processes ?? [];

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return q ? all.filter((p) => matches(p, q)) : all;
  }, [all, deferredQuery]);

  const sorted = useMemo(() => sortProcesses(filtered, sort.key, sort.dir), [filtered, sort.key, sort.dir]);

  // A search narrows enough to be worth showing whole; an unfiltered list does not.
  const visible = searching ? sorted : sorted.slice(0, limit);

  // Magnitude scale for the bar, taken from the CURRENTLY SORTED metric so the bar
  // always encodes what the reader just asked to rank by. Bar length is this
  // design's magnitude channel — never a second colour.
  const barMax = useMemo(() => {
    if (sort.key === "name" || sort.key === "pid") return 0;
    let m = 0;
    for (const p of sorted) {
      const v = numericValue(p, sort.key);
      if (v != null && v > m) m = v;
    }
    return m;
  }, [sorted, sort.key]);

  const cores = data?.cores ?? 0;

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

  return (
    <div className="space-y-2">
      {/* search + census. Not a card grid, not a hero metric: one control and the
          count it acts on, on the same line the table starts. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="panel flex items-center gap-2 px-2.5 flex-1 min-w-[12rem] focus-within:border-accent/40 transition-colors">
          <Search size={13} className="text-ink-faint shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter by name, pid, container, command…"
            aria-label="Filter processes"
            className="flex-1 min-w-0 h-11 md:h-8 bg-transparent text-xs text-ink placeholder:text-ink-faint outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear filter"
              className="shrink-0 text-ink-faint hover:text-ink cursor-pointer p-1 -mr-1"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div className="microlabel shrink-0" aria-live="polite">
          {searching ? `${filtered.length} of ${all.length}` : `${all.length} processes`}
          {data && data.skipped > 0 && (
            <span title="pids that exited or were unreadable during the scan — normal on a busy box">
              {" · "}
              {data.skipped} skipped
            </span>
          )}
        </div>
      </div>

      <div className="panel">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col />
            <col className="w-14 lg:w-16" />
            <col className="w-16 sm:w-20" />
            <col className="w-[4.5rem] sm:w-24" />
            <col className="w-24" />
            <col className="w-16" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-panel-2 border-b border-line">
            <tr>
              <SortHeader label="Process" columnKey="name" sort={sort} onSort={handleSort} />
              <SortHeader label="PID" columnKey="pid" sort={sort} onSort={handleSort} className="hidden lg:table-cell text-right" />
              <SortHeader
                label="CPU"
                columnKey="cpu"
                sort={sort}
                onSort={handleSort}
                className="text-right"
                title={cores ? `Sort by CPU — one busy core = 100%, this box has ${cores}` : "Sort by CPU"}
              />
              <SortHeader label="Mem" columnKey="mem" sort={sort} onSort={handleSort} className="text-right" />
              {/* The sublabel is not decoration: this figure is the container's, not
                  the process's, and the header is the only place that can say so
                  before the reader draws the wrong conclusion. */}
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
                  {searching ? (
                    <>
                      <p className="text-ink-dim text-sm">
                        No process matches <span className="font-mono text-ink">{deferredQuery.trim()}</span>
                      </p>
                      <p className="text-ink-faint text-xs mt-1">
                        Names come from the kernel, so they are the short executable name — try{" "}
                        <span className="font-mono">ffmpeg</span> rather than Jellyfin.
                      </p>
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="text-xs text-accent hover:underline mt-2.5 cursor-pointer"
                      >
                        Clear filter
                      </button>
                    </>
                  ) : (
                    <p className="text-ink-faint text-sm">No processes reported.</p>
                  )}
                </td>
              </tr>
            )}

            {visible.map((p, i) => {
              const tone = stateTone(p.state);
              const barValue = barMax > 0 ? numericValue(p, sort.key) : null;
              const pct = barValue != null && barMax > 0 ? Math.min(100, (barValue / barMax) * 100) : 0;
              // Six postgres processes in one container all carry that container's
              // single I/O figure. Printed six times it reads as six independent
              // 35 KiB/s consumers, which is a real misreading no header caveat
              // prevents. The value prints once per run and continuation rows point
              // at it instead — observed on live data, not hypothetical.
              const ioRepeat =
                p.cgroupIoRate != null && p.containerId != null && i > 0 && visible[i - 1].containerId === p.containerId;
              return (
                <tr key={p.pid} className="border-b border-line/40 last:border-0 hover:bg-panel-2/60 align-middle">
                  <td className="px-2 py-1.5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("dot", tone.className)} title={tone.title} />
                      <span className="font-mono text-[0.8rem] text-ink truncate" title={p.cmdline ?? displayName(p)}>
                        {displayName(p)}
                      </span>
                      {p.containerName && (
                        <span className="microlabel truncate shrink-0 max-w-[7rem] hidden sm:inline" title={`container: ${p.containerName}`}>
                          {p.containerName}
                        </span>
                      )}
                    </div>
                    {/* Magnitude bar for the active sort key. Always present, so
                        changing sort re-scales it rather than shifting the row. */}
                    <div className="mt-1 h-0.5 rounded-full bg-panel-2 overflow-hidden">
                      {pct > 0 && (
                        <div
                          className="h-full rounded-full transition-[width] duration-300 ease-out"
                          style={{ width: `${pct}%`, background: "#2dd4bf" }}
                        />
                      )}
                    </div>
                    {/* Everything the narrow layout drops from its own column lives
                        here, so a phone sorting by DISK I/O can still see the value. */}
                    <div className="flex items-baseline gap-2 mt-0.5 lg:hidden">
                      <span className="microlabel shrink-0">{p.pid}</span>
                      <span className="microlabel sm:hidden shrink-0" title="disk I/O of this process's container">
                        io {p.cgroupIoRate != null ? formatRate(p.cgroupIoRate) : "—"}
                      </span>
                      {p.containerName && <span className="microlabel truncate sm:hidden">{p.containerName}</span>}
                    </div>
                  </td>

                  <td className="px-2 py-1.5 text-right hidden lg:table-cell font-mono text-[0.72rem] text-ink-dim">{p.pid}</td>

                  <td
                    className="px-2 py-1.5 text-right font-mono text-[0.75rem] text-ink"
                    title={
                      p.cpuPct == null
                        ? "not measured yet — a CPU figure needs two samples, and this process appeared after the last one"
                        : cores
                          ? `${formatPercent(p.cpuPct, 1)} of one core · ${formatPercent(p.cpuPct / cores, 1)} of the box`
                          : undefined
                    }
                  >
                    {p.cpuPct == null ? <span className="text-ink-faint">—</span> : formatPercent(p.cpuPct, 1)}
                  </td>

                  <td className="px-2 py-1.5 text-right font-mono text-[0.75rem] text-ink">{formatBytes(p.rssBytes)}</td>

                  <td
                    className="px-2 py-1.5 text-right hidden sm:table-cell font-mono text-[0.75rem]"
                    title={
                      p.cgroupIoRate == null
                        ? p.containerId
                          ? "this container's cgroup reported no readable io.stat"
                          : "no container — per-process disk I/O is not readable without root"
                        : ioRepeat
                          ? `same ${p.containerName ?? "container"} cgroup as the row above — ${formatRate(p.cgroupIoRate)} for the container in total, not per process`
                          : `${p.containerName ?? "container"} cgroup total, shared by all its processes`
                    }
                  >
                    {p.cgroupIoRate == null ? (
                      <span className="text-ink-faint">—</span>
                    ) : ioRepeat ? (
                      <span className="text-ink-faint" aria-label="same container as the row above">
                        ↳
                      </span>
                    ) : (
                      // ink-dim, not ink: the number is real but it is the
                      // container's, and it should not read as louder than the
                      // two figures on this row that genuinely belong to the pid.
                      <span className="text-ink-dim">{formatRate(p.cgroupIoRate)}</span>
                    )}
                  </td>

                  <td className="px-2 py-1.5 text-right hidden lg:table-cell font-mono text-[0.72rem] text-ink-dim">{p.threads}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!searching && sorted.length > visible.length && (
          <div className="border-t border-line px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <span className="microlabel">
              showing top {visible.length} of {sorted.length}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE)}
                className="text-xs text-ink-dim hover:text-accent cursor-pointer"
              >
                Show {Math.min(PAGE, sorted.length - visible.length)} more
              </button>
              <button
                type="button"
                onClick={() => setLimit(sorted.length)}
                className="text-xs text-ink-dim hover:text-accent cursor-pointer"
              >
                Show all
              </button>
            </div>
          </div>
        )}
        {!searching && limit > PAGE && sorted.length <= visible.length && (
          <div className="border-t border-line px-3 py-2">
            <button
              type="button"
              onClick={() => setLimit(PAGE)}
              className="text-xs text-ink-dim hover:text-accent cursor-pointer"
            >
              Collapse to top {PAGE}
            </button>
          </div>
        )}
      </div>

      {/* Stated once, plainly, rather than repeated per row: the DISK I/O column
          is a different scope from the two beside it, and the reason is a
          permission boundary the dashboard deliberately does not cross. */}
      <p className="text-ink-faint text-[0.68rem] leading-relaxed">
        CPU and memory are measured per process. <span className="text-ink-dim">Disk I/O is per container</span> — it is
        the cgroup&apos;s combined read+write rate, printed once per container with{" "}
        <span className="font-mono text-ink-dim">↳</span> on its other processes, because per-process I/O counters are
        readable only by root and this dashboard runs unprivileged.
      </p>
    </div>
  );
}
