/* Rows for the /docker page: container, image and volume, plus the folded list that holds them.
   Quiet at rest: outline buttons, neutral dots, and red only on a confirm step inside the action components. */
"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { stateDotClass } from "@/components/resources/container-tile";
import { useLifecycle } from "@/components/resources/container-controls";
import { ImageDeleteAction, type ImageDeleteResult } from "@/components/resources/image-delete-action";
import { RemoveContainerAction } from "@/components/resources/remove-container-action";
import { REMOVABLE_STATES } from "@/lib/container-remove";
import { fold, foldGroups, type ImageItem } from "@/lib/docker-chores";
import { formatBytes, relativeTime } from "@/lib/format";
import { isProtectedContainer } from "@/lib/protected-containers";
import type { TiledContainer } from "@/lib/client";
import { cn } from "@/lib/utils";

export interface VolumeItem {
  name: string;
  driver?: string;
  created?: string | null;
  usedBy?: string[];
  /** Orphans carry a size; null while Docker is still sizing it. */
  size?: number | null;
}

/** A size cell that never jitters: tabular, fixed min-width, "sizing…" while unknown. */
export function Size({ bytes, pending }: { bytes: number | null; pending?: boolean }) {
  const wait = pending || bytes == null;
  return (
    <span className="dk-size" data-pending={wait ? "1" : undefined}>
      {wait ? "sizing…" : formatBytes(bytes, 1)}
    </span>
  );
}

const ago = (epochSeconds: number) => relativeTime(epochSeconds * 1000);

function RowShell({
  rowId,
  leaving,
  dot,
  name,
  meta,
  children,
}: {
  rowId: string;
  leaving?: boolean;
  dot?: string;
  name: string;
  meta: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="dk-row" data-row-id={rowId} data-leaving={leaving ? "1" : undefined}>
      <div className="dk-row-main">
        {dot && <span className={cn("dot", dot)} aria-hidden />}
        <div className="dk-row-text">
          <span className="dk-name font-mono" title={name}>
            {name}
          </span>
          <span className="dk-meta">{meta}</span>
        </div>
      </div>
      <div className="dk-row-acts">{children}</div>
    </li>
  );
}

function StartButton({ id, onDone }: { id: string; onDone: () => void }) {
  const life = useLifecycle(id, onDone);
  const busy = life.pending === "start";
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" data-feature="start" disabled={busy} className="min-w-20" onClick={() => void life.run("start")}>
        {busy ? "Starting…" : "Start"}
      </Button>
      {life.error && (
        <span className="dk-failed">
          {life.error}
          <Button size="sm" variant="outline" onClick={() => void life.run("start")}>
            Retry
          </Button>
        </span>
      )}
    </div>
  );
}

export function ContainerRow({
  c,
  rowId,
  mode,
  leaving,
  onStarted,
  onRemoved,
}: {
  c: TiledContainer;
  rowId: string;
  /** `chore`: stack and age lead the meta, Start is offered. `all`: image and state lead, Remove only. */
  mode: "chore" | "all";
  leaving?: boolean;
  onStarted?: (id: string) => void;
  onRemoved?: (id: string) => void;
}) {
  const stopped = REMOVABLE_STATES.includes(c.state) || c.state === "dead";
  const protectedBox = isProtectedContainer(c);
  const removable = REMOVABLE_STATES.includes(c.state) && !protectedBox;
  const meta =
    mode === "chore"
      ? c.state === "dead"
        ? `${c.composeProject ?? "no stack"} · dead: remove with the Docker CLI`
        : stopped
          ? `${c.composeProject ?? "no stack"} · created ${ago(c.created)}`
          : `${c.composeProject ?? "no stack"} · ${c.state}`
      : `${c.image} · ${c.state}`;
  return (
    <RowShell rowId={rowId} leaving={leaving} dot={c.state === "dead" ? "dot-stopped" : stateDotClass(c)} name={c.name} meta={meta}>
      <Link href={`/containers/${c.id.slice(0, 12)}`} data-feature="details" className="dk-link" aria-label={`Details for ${c.name}`}>
        Details
      </Link>
      {mode === "chore" && (c.state === "created" || c.state === "exited") && !protectedBox && (
        <StartButton id={c.id} onDone={() => onStarted?.(c.id)} />
      )}
      {removable && <RemoveContainerAction id={c.id} name={c.name} onRemoved={() => onRemoved?.(c.id)} />}
      {!stopped && mode === "chore" && (
        <Button size="sm" variant="outline" disabled title="running" aria-label={`Remove ${c.name}, unavailable: running`}>
          Remove
        </Button>
      )}
    </RowShell>
  );
}

export function imageName(i: { id: string; tags: string[] }): string {
  return i.tags[0] ?? `<none> ${i.id.replace(/^sha256:/, "").slice(0, 12)}`;
}

export function ImageRow({
  i,
  rowId,
  deletable,
  leaving,
  onDeleted,
}: {
  i: ImageItem;
  rowId: string;
  deletable: boolean;
  leaving?: boolean;
  onDeleted: (r: ImageDeleteResult) => void;
}) {
  const meta = `${i.stack ?? "no stack"} · ${formatBytes(i.size, 1)} · created ${ago(i.created)}${i.inUse ? ` · in use by ${i.usedBy.join(", ")}` : ""}`;
  return (
    <RowShell rowId={rowId} leaving={leaving} name={imageName(i)} meta={meta}>
      {deletable && (
        <ImageDeleteAction
          imageId={i.id}
          label={imageName(i)}
          size={i.size}
          inUse={i.inUse}
          usedBy={i.usedBy}
          text="Delete"
          onDeleted={onDeleted}
        />
      )}
    </RowShell>
  );
}

export function VolumeRow({ v, rowId, leaving }: { v: VolumeItem; rowId: string; leaving?: boolean }) {
  const parts = [
    v.size !== undefined ? (v.size == null ? "sizing…" : formatBytes(v.size, 1)) : null,
    v.usedBy ? (v.usedBy.length ? `used by ${v.usedBy.join(", ")}` : "no container mounts it") : null,
    v.created ? `created ${relativeTime(v.created)}` : null,
  ].filter(Boolean);
  return <RowShell rowId={rowId} leaving={leaving} name={v.name} meta={parts.join(" · ")} />;
}

/** Fold at 12 with "Show all N"; a name prefix shared by 8 or more rows collapses into one group head. */
export function FoldList({
  items,
  render,
  grouping = false,
  noun = "rows",
}: {
  items: { id: string; name: string }[];
  render: (id: string) => React.ReactNode;
  grouping?: boolean;
  noun?: string;
}) {
  const [all, setAll] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const { groups, rest } = grouping ? foldGroups(items) : { groups: [], rest: items.map((i) => i.id) };
  const { shown, hidden } = fold(rest, all);
  return (
    <ul className="dk-list">
      {groups.map((g) => (
        <li key={g.prefix} className="dk-group">
          <button
            type="button"
            className="dk-group-head"
            aria-expanded={openGroups.has(g.prefix)}
            onClick={() =>
              setOpenGroups((s) => {
                const n = new Set(s);
                if (!n.delete(g.prefix)) n.add(g.prefix);
                return n;
              })
            }
          >
            <span className="font-mono text-xs">{g.prefix}-*</span>
            <span className="text-xs text-ink-dim">
              {g.ids.length} {noun}
            </span>
          </button>
          {openGroups.has(g.prefix) && <ul className="dk-list">{g.ids.map(render)}</ul>}
        </li>
      ))}
      {shown.map(render)}
      {hidden > 0 && (
        <li className="dk-more">
          <Button size="sm" variant="outline" onClick={() => setAll(true)}>
            Show all {rest.length}
          </Button>
        </li>
      )}
    </ul>
  );
}
