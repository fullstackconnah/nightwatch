"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import type { TiledContainer, WidgetData } from "@/lib/client";

export function stateDotClass(c: { state: string; health: string | null }): string {
  if (c.health === "unhealthy") return "dot-unhealthy";
  if (c.state === "running") return "dot-running";
  if (c.state === "restarting") return "dot-restarting";
  if (c.state === "dead") return "dot-dead";
  return "dot-stopped";
}

function TileIcon({ icon, name }: { icon: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (icon && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        width={28}
        height={28}
        className="rounded"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded bg-panel-2 border border-line flex items-center justify-center font-mono text-xs text-accent uppercase">
      {name.slice(0, 2)}
    </div>
  );
}

export function ContainerTile({
  container: c,
  widget,
  stats,
}: {
  container: TiledContainer;
  widget?: WidgetData;
  stats?: { cpuPct: number; memBytes: number };
}) {
  return (
    <div
      className={cn(
        "panel panel-hover block p-3 group relative",
        c.state !== "running" && "opacity-60",
      )}
    >
      <Link
        href={`/containers/${c.id.slice(0, 12)}`}
        aria-label={c.name}
        className="absolute inset-0 rounded-[inherit] focus-visible:ring-1 focus-visible:ring-accent"
      />
      <div className="flex items-center gap-2.5">
        <TileIcon icon={c.tile.icon} name={c.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("dot", stateDotClass(c))} />
            <span className="text-sm font-medium truncate">{c.name}</span>
          </div>
          <div className="text-[0.68rem] text-ink-faint font-mono truncate" title={c.image}>
            {c.image.replace(/^(ghcr\.io|lscr\.io|docker\.io)\//, "")}
          </div>
          {stats && c.state === "running" && (
            <div className="text-[0.68rem] text-ink-dim font-mono truncate">
              cpu {stats.cpuPct.toFixed(1)}% · mem {formatBytes(stats.memBytes, 0)}
            </div>
          )}
        </div>
        {c.tile.url && (
          <a
            href={c.tile.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="hover-reveal text-ink-dim hover:text-accent p-3 -m-2 md:p-1 md:m-0 relative z-10"
            title={`Open ${c.tile.url}`}
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      {widget && !widget.error && widget.fields.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-line grid grid-cols-2 gap-x-3 gap-y-1">
          {widget.fields.slice(0, 4).map((f) => (
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
      {widget?.error && (
        <div className="mt-2.5 pt-2 border-t border-line microlabel !text-warn/70">
          widget: {widget.error}
        </div>
      )}
    </div>
  );
}
