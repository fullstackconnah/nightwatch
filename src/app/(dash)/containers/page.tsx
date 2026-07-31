"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Badge, stateBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useContainers, type TiledContainer } from "@/lib/client";
import { cn } from "@/lib/utils";

/** Same five verbs, same icons, same order as the overview cards and the detail
 *  header — the vocabulary is defined once in container-controls and rendered
 *  three times, so no surface can drift into meaning something different. */
function RowActions({ c, onDone }: { c: TiledContainer; onDone: () => void }) {
  const lifecycle = useLifecycle(c.id, onDone);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-0.5 justify-end">
        <LifecycleActions state={c.state} name={c.name} lifecycle={lifecycle} />
        {c.tile.url && <OpenAppLink url={c.tile.url} name={c.name} />}
      </div>
      <LifecycleError lifecycle={lifecycle} className="max-w-56 justify-end text-right" />
    </div>
  );
}

export default function ContainersPage() {
  const { data, mutate } = useContainers(5000);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    return (data?.containers ?? [])
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, query]);

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
              {["Name", "State", "Image", "Ports", "Stack", "Uptime", ""].map((h) => (
                <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
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
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ink-faint text-sm">
                  {data ? "no containers match" : "loading…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        {rows.map((c) => (
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
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <ContainerStatus c={c} />
              <PortChips ports={c.ports} max={4} />
            </div>
            <div className="text-xs text-ink-dim">{c.composeProject ?? "not compose-managed"}</div>
            <div className="pt-1 border-t border-line/50">
              <RowActions c={c} onDone={() => mutate()} />
            </div>
          </div>
        ))}
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
