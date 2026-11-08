/* The chore list. Order follows the answer (R2: prunes first, only they may be re-ranked), and an open chore's
   membership is held by a snapshot of row ids (R4): counts, sizes and states stay live, rows neither join nor leave
   until the pill is tapped or the owner's own write commits. */
"use client";

import { useReducer, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PruneAction } from "@/components/resources/reclaim-shared";
import type { ImageDeleteResult } from "@/components/resources/image-delete-action";
import { createRanker } from "@/lib/watchlist";
import {
  buildChores,
  choreOrder,
  heldMembers,
  snapAfterWrite,
  pillText,
  reclaimPrefix,
  type Chore,
  type ChoreId,
  type ChoreInput,
  type ImageItem,
} from "@/lib/docker-chores";
import type { TiledContainer } from "@/lib/client";
import type { PruneResult } from "@/lib/docker";
import { cn } from "@/lib/utils";
import { ContainerRow, FoldList, ImageRow, Size, VolumeRow, imageName } from "./rows";
import { useCountTo, useFlip } from "./motion";

export interface ChoresProps {
  input: ChoreInput | null;
  containers: TiledContainer[];
  images: ImageItem[];
  sizesPending: boolean;
  /** Per-source failure text; each only speaks for its own chore. */
  errors: { containers: string | null; images: string | null; volumes: string | null };
  /** Docker is down: every write control is disabled (the slot says why). */
  down: boolean;
  /** Refetch everything; resolves when fresh data is in. */
  refresh: () => Promise<unknown>;
}

interface Entry {
  id: string;
  name: string;
  node: (leaving: boolean) => React.ReactNode;
}

const PRUNE: Partial<Record<ChoreId, { target: "images" | "volumes"; label: string }>> = {
  dangling: { target: "images", label: "dangling images" },
  orphans: { target: "volumes", label: "orphan volumes" },
};

function CountSize({ bytes, pending, prefix }: { bytes: number | null; pending: boolean; prefix?: string }) {
  const v = useCountTo(bytes ?? 0);
  return <Size bytes={bytes == null ? null : v} pending={pending} prefix={prefix} />;
}

export function Chores(p: ChoresProps) {
  const [open, setOpen] = useState<Set<ChoreId>>(new Set());
  const [snaps, setSnaps] = useState<Partial<Record<ChoreId, string[] | null>>>({});
  const [ownerGone, setOwnerGone] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const rk = useRef(createRanker()).current;
  const listRef = useRef<HTMLOListElement>(null);
  const seen = useRef(new Map<string, Entry>());
  const latest = useRef<Partial<Record<ChoreId, string[]>>>({}); // newest member ids per chore, filled in render

  const chores = p.input ? buildChores(p.input) : [];
  const base = choreOrder(chores);
  const tier0 = base.filter((c) => c.kind === "prune" && c.count > 0).map((c) => c.id);
  const el = listRef.current;
  const held = !!el && (el.matches(":hover") || el.contains(document.activeElement));
  rk.offer(tier0, Date.now(), held);
  const committed = (rk.order ?? []).filter((id) => tier0.includes(id as ChoreId)) as ChoreId[];
  const order: Chore[] = [...committed, ...tier0.filter((id) => !committed.includes(id))]
    .map((id) => base.find((c) => c.id === id) as Chore)
    .concat(base.filter((c) => !tier0.includes(c.id)));

  const flip = useFlip(listRef, order.map((c) => c.id).join() + "|" + Object.values(snaps).flat().join() + "|" + [...ownerGone].join());

  const input = p.input;
  const imgById = new Map(p.images.map((i) => [i.id, i]));
  const ctrById = new Map(p.containers.map((c) => [c.id, c]));

  function lookup(chore: ChoreId, id: string): Entry | undefined {
    const rowId = `${chore}-${id}`;
    let e: Entry | undefined;
    if (chore === "stopped") {
      const c = ctrById.get(id);
      if (c)
        e = {
          id,
          name: c.name,
          node: (lv) => (
            <ContainerRow key={rowId} c={c} rowId={rowId} mode="chore" leaving={lv} onStarted={ownerWrite(chore, id)} onRemoved={ownerWrite(chore, id)} />
          ),
        };
    } else if (chore === "orphans") {
      const v = input?.reclaim.volumes.orphans.find((o) => o.name === id);
      if (v) e = { id, name: id, node: (lv) => <VolumeRow key={rowId} v={v} rowId={rowId} leaving={lv} /> };
    } else {
      const d = input?.reclaim.images.dangling.find((x) => x.id === id) as (Partial<ImageItem> & { id: string }) | undefined;
      const i: ImageItem | undefined = imgById.get(id) ?? (d && { tags: [], size: 0, created: 0, ...d, inUse: false, usedBy: [], stack: null });
      if (i)
        e = {
          id,
          name: imageName(i),
          node: (lv) => <ImageRow key={rowId} i={i} rowId={rowId} deletable={chore === "unused"} leaving={lv} onDeleted={(r) => imageDeleted(chore, id, r)} />,
        };
    }
    if (e) seen.current.set(rowId, e);
    return e ?? seen.current.get(rowId);
  }

  /** The owner's own write commits at once: fade the row out (240 ms), then take the fresh data. */
  function ownerWrite(chore: ChoreId, id: string) {
    return () => {
      const rowId = `${chore}-${id}`;
      setLeaving((s) => new Set(s).add(rowId));
      setTimeout(() => {
        setOwnerGone((s) => new Set(s).add(rowId));
        setLeaving((s) => {
          const n = new Set(s);
          n.delete(rowId);
          return n;
        });
        void p.refresh().finally(() => {
          setSnaps((s) => snapAfterWrite(s, chore, latest.current[chore], id));
          setOwnerGone((s) => {
            const n = new Set(s);
            n.delete(rowId);
            return n;
          });
        });
      }, 240);
    };
  }
  const imageDeleted = (chore: ChoreId, id: string, _r: ImageDeleteResult) => ownerWrite(chore, id)();
  const pruned = (chore: ChoreId, _r: PruneResult) => {
    void p.refresh().finally(() => setSnaps((s) => snapAfterWrite(s, chore, latest.current[chore])));
  };

  function toggle(c: Chore) {
    flip.skip();
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(c.id)) n.add(c.id);
      return n;
    });
    setSnaps((s) => ({ ...s, [c.id]: open.has(c.id) ? null : c.memberIds }));
  }

  if (!input) {
    if (p.down) return null; // nothing was ever loaded and Docker is down: the band says so, no endless skeleton
    return (
      <ol className="panel dk-chore-list" aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="dk-chore">
            <div className="dk-chore-head dk-skel" />
          </li>
        ))}
      </ol>
    );
  }

  const sourceError = (c: Chore) =>
    c.id === "stopped" ? (p.errors.containers && `Couldn't read containers: ${p.errors.containers}`)
    : c.id === "dangling" || c.id === "unused" ? (p.errors.images && `Couldn't read images: ${p.errors.images}`)
    : c.id === "orphans" ? (p.errors.volumes && `Couldn't read volumes: ${p.errors.volumes}`)
    : null;
  const emptyNote = (c: Chore) =>
    c.id === "dangling" ? "No dangling images."
    : c.id === "orphans" ? (input.volumes.length ? "No orphan volumes. Named volumes are never cleared here." : "No volumes. App data lives in bind mounts.")
    : c.id === "unused" ? "Every tagged image is in use."
    : c.id === "stopped" ? "Every container is running."
    : c.note;

  return (
    <fieldset disabled={p.down} className="dk-fieldset">
      <ol ref={listRef} className="panel dk-chore-list" onPointerLeave={bump} onBlur={bump}>
        {order.map((c) => {
          const isOpen = open.has(c.id) && c.count > 0;
          latest.current[c.id] = c.memberIds;
          const live = c.memberIds.filter((id) => !ownerGone.has(`${c.id}-${id}`));
          const snap = snaps[c.id] ?? null;
          const m = heldMembers(snap, live);
          const pill = isOpen ? pillText(m.newIds.length, m.goneIds.length) : "";
          const entries = m.rows
            .filter((id) => !ownerGone.has(`${c.id}-${id}`))
            .map((id) => lookup(c.id, id))
            .filter((e): e is Entry => !!e);
          if (c.id === "stopped") entries.sort((a, b) => a.name.localeCompare(b.name));
          const err = sourceError(c);
          const prune = PRUNE[c.id];
          return (
            <li key={c.id} className="dk-chore" data-row-id={`chore-${c.id}`} data-chore={c.id}>
              <div className="dk-chore-head">
                <div className="dk-chore-title">
                  <h3>
                    {c.count > 0 && c.kind !== "cache" ? (
                      <button
                        type="button"
                        className="dk-disclose"
                        aria-expanded={isOpen}
                        aria-controls={`dk-body-${c.id}`}
                        onClick={() => toggle(c)}
                      >
                        <ChevronDown size={14} className={cn("dk-chev", isOpen && "dk-chev-open")} aria-hidden />
                        {c.title}
                      </button>
                    ) : (
                      c.title
                    )}
                    {c.count > 0 && c.kind !== "cache" && <span className="dk-count font-mono">{c.count}</span>}
                  </h3>
                  <p className="dk-note">{err || (c.count > 0 || c.kind === "cache" ? c.note : emptyNote(c))}</p>
                </div>
                <div className="dk-chore-size">
                  {c.kind === "cache" || c.id === "stopped" ? null : (
                    <CountSize bytes={c.bytes} pending={c.id === "orphans" && p.sizesPending} prefix={prune ? reclaimPrefix(prune.target) : ""} />
                  )}
                </div>
                <div className="dk-chore-act">
                  {prune && c.count > 0 && (
                    <PruneAction
                      target={prune.target}
                      itemLabel={prune.label}
                      count={c.count}
                      bytes={c.bytes}
                      onPruned={(r) => pruned(c.id, r)}
                    />
                  )}
                  {isOpen && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="dk-new"
                      data-visible={pill ? "1" : "0"}
                      aria-hidden={!pill}
                      tabIndex={pill ? 0 : -1}
                      onClick={() => setSnaps((s) => ({ ...s, [c.id]: live }))}
                    >
                      {pill || "Update list"}
                    </Button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="dk-chore-body" id={`dk-body-${c.id}`}>
                  <FoldList
                    items={entries}
                    grouping={c.id === "stopped"}
                    noun="stopped containers"
                    render={(id) => entries.find((e) => e.id === id)?.node(leaving.has(`${c.id}-${id}`))}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
