"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ExternalLink, Play, Plus, RotateCw, Search, Square } from "lucide-react";
import { Badge, stateBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stateDotClass } from "@/components/container-tile";
import { CreateContainerDialog } from "@/components/create-container";
import { postJson, useContainers, type TiledContainer } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function RowActions({ c, onDone }: { c: TiledContainer; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function act(action: "start" | "stop" | "restart") {
    setBusy(action);
    try {
      await postJson(`/api/docker/containers/${c.id.slice(0, 12)}/action`, { action });
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  }
  const running = c.state === "running";
  return (
    <div className="flex items-center gap-1 justify-end">
      {!running && (
        <Button size="icon" variant="ghost" title="Start" disabled={!!busy} onClick={() => act("start")}>
          <Play size={13} className={busy === "start" ? "animate-pulse" : ""} />
        </Button>
      )}
      {running && (
        <>
          <Button size="icon" variant="ghost" title="Restart" disabled={!!busy} onClick={() => act("restart")}>
            <RotateCw size={13} className={busy === "restart" ? "animate-spin" : ""} />
          </Button>
          <Button size="icon" variant="ghost" title="Stop" disabled={!!busy} onClick={() => act("stop")}>
            <Square size={13} className={busy === "stop" ? "animate-pulse" : ""} />
          </Button>
        </>
      )}
      {c.tile.url && (
        <a href={c.tile.url} target="_blank" rel="noreferrer" title="Open app"
          className="p-1.5 text-ink-dim hover:text-accent">
          <ExternalLink size={13} />
        </a>
      )}
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
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Containers</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            {data ? `${data.counts.running}/${data.counts.total} running` : "…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input
              placeholder="filter by name or image…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 w-64"
            />
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New container
          </Button>
        </div>
      </header>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Name", "State", "Image", "Ports", "Stack", "Created", ""].map((h) => (
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
                <td className="px-3 py-2 font-mono text-xs text-ink-dim">
                  {c.ports
                    .filter((p) => p.public)
                    .slice(0, 3)
                    .map((p) => p.public)
                    .join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-xs text-ink-dim">{c.composeProject ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-ink-faint whitespace-nowrap">
                  {relativeTime(c.created * 1000)}
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
