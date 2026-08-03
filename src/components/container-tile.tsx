"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ContainerStatus,
  LifecycleActions,
  LifecycleError,
  OpenAppLink,
  PortChips,
  actionsFor,
  publishedPorts,
  useLifecycle,
} from "@/components/container-controls";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { hasWidgetActions, WidgetActionsMenu } from "@/components/widget-actions";
import type { TiledContainer, WidgetData } from "@/lib/client";

export function stateDotClass(c: { state: string; health: string | null }): string {
  if (c.health === "unhealthy") return "dot-unhealthy";
  if (c.state === "running") return "dot-running";
  if (c.state === "restarting") return "dot-restarting";
  if (c.state === "paused") return "dot-paused";
  if (c.state === "dead") return "dot-dead";
  return "dot-stopped";
}

/** Group separator for the telemetry strip — without it "mem 133 MiB" and the
 *  next value run together into one number nobody can parse at a glance. */
function Divider() {
  return (
    <span className="text-ink-faint" aria-hidden="true">
      ·
    </span>
  );
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
  onChanged,
  rankValue,
}: {
  container: TiledContainer;
  widget?: WidgetData;
  stats?: { cpuPct: number; memBytes: number };
  onChanged?: () => void;
  /** Set only when the overview grid is flattened into a ranked list (sort !=
   *  groups): the value the reader ranked by, printed mono beside the name so
   *  the ordering has a number to point at instead of asking for trust. */
  rankValue?: { label: string; value: string };
}) {
  const lifecycle = useLifecycle(c.id, onChanged);
  const running = c.state === "running";
  const hasActions = actionsFor(c.state).length > 0;
  const showWidgetActions = hasWidgetActions(widget);

  return (
    <div
      className={cn(
        "panel panel-hover block p-3 group relative",
        // Deliberately not opacity on the card: a blanket 0.6 drags every label
        // inside it under 4.5:1 against the panel, including the state text that
        // is the whole reason to look at a stopped tile. Dim the ground instead
        // and let the contents keep their own contrast.
        !running && c.state !== "paused" && "bg-panel/40 border-line/70",
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
            <span className={cn("text-sm font-medium truncate", !running && "text-ink-dim")}>
              {c.name}
            </span>
          </div>
          <div className="text-[0.68rem] text-ink-faint font-mono truncate" title={c.image}>
            {c.image.replace(/^(ghcr\.io|lscr\.io|docker\.io)\//, "")}
          </div>
        </div>
        {rankValue && (
          // Neutral mono, not a threshold colour — a high number here is the
          // reader's own sort choice, not an alarm (Threshold Rule).
          <div className="text-right shrink-0">
            <div className="font-mono text-sm text-ink tabular-nums">{rankValue.value}</div>
            <div className="microlabel">{rankValue.label}</div>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[0.68rem]">
        <ContainerStatus c={c} />
        {stats && running && (
          <>
            <Divider />
            <span className="text-ink-dim font-mono">
              cpu {stats.cpuPct.toFixed(1)}% · mem {formatBytes(stats.memBytes, 0)}
            </span>
          </>
        )}
      </div>

      <LifecycleError lifecycle={lifecycle} className="mt-1.5 relative z-10" />

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

      {/* The control lane. Always visible, always at the same edge of every
          card, and sharing its row with the published ports — which is what
          pays for the height it costs.

          It was briefly a hover-revealed cluster up in the header instead. That
          reads cleaner at rest and is wrong: an opacity-0 element still holds
          its width, so four buttons quietly took ~130px away from the container
          name on a 240px card and turned "nginx-proxy-manager" into
          "nginx-proxy-…". Reserving the space elsewhere only moves the damage;
          overlaying the buttons hides the name of the thing you are about to
          stop. A row of their own is the only version that costs nothing it
          shouldn't. */}
      {(hasActions || c.tile.url || showWidgetActions || publishedPorts(c.ports).length > 0) && (
        <div className="mt-2.5 pt-1.5 border-t border-line/60 flex items-center justify-between gap-2 relative z-10">
          <PortChips ports={c.ports} className="text-[0.68rem] min-w-0" />
          <div className="flex items-center gap-0.5 ml-auto">
            <LifecycleActions state={c.state} name={c.name} lifecycle={lifecycle} />
            {c.tile.url && <OpenAppLink url={c.tile.url} name={c.name} />}
            {showWidgetActions && widget && <WidgetActionsMenu container={c.name} widgetType={widget.type} />}
          </div>
        </div>
      )}
    </div>
  );
}
