"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronUp, Plus, Search } from "lucide-react";
import { Badge, stateBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { stateDotClass } from "@/components/container-tile";
import {
  ContainerStatus,
  LifecycleActions,
  LifecycleError,
  OpenAppLink,
  PortChips,
  useLifecycle,
} from "@/components/container-controls";
import { CreateContainerDialog } from "@/components/create-container";
import { useContainers, useResources, type TiledContainer } from "@/lib/client";
import { formatBytes } from "@/lib/format";
import { processesHref, stateSeverity } from "@/lib/container-rank";
import { cn } from "@/lib/utils";

type SortKey = "name" | "cpu" | "mem" | "state";
type SortDir = "asc" | "desc";
type Stats = { cpuPct: number; memBytes: number };

const SORT_COLUMN_LABEL: Record<SortKey, string> = { name: "Name", cpu: "CPU", mem: "Mem", state: "State" };

const MOBILE_SORT_OPTIONS: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: "name", dir: "asc", label: "Name (A–Z)" },
  { key: "name", dir: "desc", label: "Name (Z–A)" },
  { key: "cpu", dir: "desc", label: "CPU (high → low)" },
  { key: "cpu", dir: "asc", label: "CPU (low → high)" },
  { key: "mem", dir: "desc", label: "Mem (high → low)" },
  { key: "mem", dir: "asc", label: "Mem (low → high)" },
  { key: "state", dir: "asc", label: "State (needs attention first)" },
  { key: "state", dir: "desc", label: "State (healthy first)" },
];

function compareContainers(a: TiledContainer, b: TiledContainer, key: SortKey, statsById: Map<string, Stats>): number {
  switch (key) {
    case "cpu":
      return (statsById.get(a.id)?.cpuPct ?? 0) - (statsById.get(b.id)?.cpuPct ?? 0);
    case "mem":
      return (statsById.get(a.id)?.memBytes ?? 0) - (statsById.get(b.id)?.memBytes ?? 0);
    case "state":
      return stateSeverity(a) - stateSeverity(b);
    default:
      return a.name.localeCompare(b.name);
  }
}

/** Processes → deep link: another surface (G1) makes `q` prefill the resources
 *  filter — this is just the address every containers-side link points at. */
function ProcessesLink({ name }: { name: string }) {
  return (
    <Link
      href={processesHref(name)}
      aria-label={`${name} processes`}
      title="Processes →"
      className="inline-flex items-center justify-center h-10 w-10 md:h-7 md:w-7 rounded-md text-ink-dim hover:text-accent focus-visible:text-accent outline-none focus-visible:ring-1 focus-visible:ring-accent transition"
    >
      <Activity size={13} />
    </Link>
  );
}

/** Same five verbs, same icons, same order as the overview cards and the detail
 *  header — the vocabulary is defined once in container-controls and rendered
 *  three times, so no surface can drift into meaning something different. */
function RowActions({ c, onDone }: { c: TiledContainer; onDone: () => void }) {
  const lifecycle = useLifecycle(c.id, onDone);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-0.5 justify-end">
        <LifecycleActions state={c.state} name={c.name} lifecycle={lifecycle} />
        <ProcessesLink name={c.name} />
        {c.tile.url && <OpenAppLink url={c.tile.url} name={c.name} />}
      </div>
      <LifecycleError lifecycle={lifecycle} className="max-w-56 justify-end text-right" />
    </div>
  );
}

/** Clickable column header carrying its own sort state — same button for every
 *  sortable column, so "click a header to sort" means the same thing in all four. */
function SortableHeader({
  column,
  active,
  dir,
  onSort,
}: {
  column: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (column: SortKey) => void;
}) {
  return (
    <th
      className="px-3 py-2 text-left"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="microlabel inline-flex items-center gap-0.5 hover:text-ink cursor-pointer"
      >
        {SORT_COLUMN_LABEL[column]}
        {active &&
          (dir === "asc" ? (
            <ChevronUp size={11} className="text-accent" aria-hidden="true" />
          ) : (
            <ChevronDown size={11} className="text-accent" aria-hidden="true" />
          ))}
      </button>
    </th>
  );
}

export default function ContainersPage() {
  const { data, mutate } = useContainers(5000);
  const { data: resourceData } = useResources(10000);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showCreate, setShowCreate] = useState(false);

  const statsById = useMemo(() => {
    const map = new Map<string, Stats>();
    for (const c of resourceData?.containers ?? []) {
      map.set(c.id, { cpuPct: c.cpuPct, memBytes: c.memBytes });
    }
    return map;
  }, [resourceData]);

  function handleSort(column: SortKey) {
    if (sortKey === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column);
      // Numeric columns read naturally biggest-first; name/state keep their
      // own default sense (A→Z, needs-attention-first) on first click.
      setSortDir(column === "cpu" || column === "mem" ? "desc" : "asc");
    }
  }

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = (data?.containers ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q),
    );
    return filtered.sort((a, b) => {
      const cmp = compareContainers(a, b, sortKey, statsById) || a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, query, sortKey, sortDir, statsById]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Containers</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            {data ? `${data.counts.running}/${data.counts.total} running` : "…"}
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input
              placeholder="filter by name or image…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 w-full sm:w-64"
            />
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New container
          </Button>
        </div>
      </header>

      <div className="panel overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <SortableHeader column="name" active={sortKey === "name"} dir={sortDir} onSort={handleSort} />
              <SortableHeader column="state" active={sortKey === "state"} dir={sortDir} onSort={handleSort} />
              <SortableHeader column="cpu" active={sortKey === "cpu"} dir={sortDir} onSort={handleSort} />
              <SortableHeader column="mem" active={sortKey === "mem"} dir={sortDir} onSort={handleSort} />
              {["Image", "Ports", "Stack", "Uptime", ""].map((h) => (
                <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const stats = statsById.get(c.id);
              return (
                <tr key={c.id} className="border-b border-line/50 last:border-0 hover:bg-panel-2/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/containers/${c.id.slice(0, 12)}`}
                      className="flex items-center gap-2 hover:text-accent"
                    >
                      <span className={cn("dot", stateDotClass(c))} />
                      <span className="font-medium">{c.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={stateBadgeVariant(c.state, c.health)}>
                      {c.health === "unhealthy" ? "unhealthy" : c.state}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink tabular-nums">
                    {stats && c.state === "running" ? `${stats.cpuPct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink tabular-nums">
                    {stats && c.state === "running" ? formatBytes(stats.memBytes, 0) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-dim max-w-56 truncate" title={c.image}>
                    {c.image}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <PortChips ports={c.ports} max={4} />
                    {c.ports.every((p) => p.public == null) && (
                      <span className="font-mono text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-dim">{c.composeProject ?? "—"}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <ContainerStatus c={c} />
                  </td>
                  <td className="px-3 py-2">
                    <RowActions c={c} onDone={() => mutate()} />
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-ink-faint text-sm">
                  {data ? "no containers match" : "loading…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        <Select
          aria-label="Sort containers"
          value={`${sortKey}-${sortDir}`}
          onChange={(e) => {
            const [key, dir] = e.target.value.split("-") as [SortKey, SortDir];
            setSortKey(key);
            setSortDir(dir);
          }}
        >
          {MOBILE_SORT_OPTIONS.map((opt) => (
            <option key={`${opt.key}-${opt.dir}`} value={`${opt.key}-${opt.dir}`}>
              Sort: {opt.label}
            </option>
          ))}
        </Select>

        {rows.map((c) => {
          const stats = statsById.get(c.id);
          return (
            <div key={c.id} className="panel p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/containers/${c.id.slice(0, 12)}`}
                  className="flex items-center gap-2 hover:text-accent min-w-0"
                >
                  <span className={cn("dot", stateDotClass(c))} />
                  <span className="font-mono text-sm font-medium truncate">{c.name}</span>
                </Link>
                <Badge variant={stateBadgeVariant(c.state, c.health)}>
                  {c.health === "unhealthy" ? "unhealthy" : c.state}
                </Badge>
              </div>
              <div className="font-mono text-xs text-ink-dim truncate">{c.image}</div>
              {stats && c.state === "running" && (
                <div className="font-mono text-xs text-ink-dim tabular-nums">
                  cpu {stats.cpuPct.toFixed(1)}% · mem {formatBytes(stats.memBytes, 0)}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <ContainerStatus c={c} />
                <PortChips ports={c.ports} max={4} />
              </div>
              <div className="text-xs text-ink-dim">{c.composeProject ?? "not compose-managed"}</div>
              <div className="pt-1 border-t border-line/50">
                <RowActions c={c} onDone={() => mutate()} />
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className="panel p-6 text-center text-ink-faint text-sm">
            {data ? "no containers match" : "loading…"}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateContainerDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            mutate();
          }}
        />
      )}
    </div>
  );
}
