/* Everything: one search over containers, images and volumes. The list holds its rows while the pointer or focus is
   inside it and commits on leave (or on the owner's own write), so a row never moves under the pointer. */
"use client";

import { forwardRef, useReducer, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SegmentButton } from "@/components/ui/segment-button";
import type { TiledContainer } from "@/lib/client";
import type { FindKind, ImageItem } from "@/lib/docker-chores";
import { ContainerRow, FoldList, ImageRow, VolumeRow, imageName, type VolumeItem } from "./rows";

export interface EverythingProps {
  kind: FindKind;
  onKind: (k: FindKind) => void;
  containers: TiledContainer[];
  images: ImageItem[];
  volumes: VolumeItem[];
  errors: { containers: string | null; images: string | null; volumes: string | null };
  refresh: () => Promise<unknown>;
}

const SEGMENTS: { k: FindKind; label: string }[] = [
  { k: "containers", label: "Containers" },
  { k: "images", label: "Images" },
  { k: "volumes", label: "Volumes" },
];

interface Item {
  id: string;
  name: string;
  node: () => React.ReactNode;
}

export const Everything = forwardRef<HTMLElement, EverythingProps>(function Everything(p, ref) {
  const [q, setQ] = useState("");
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const listRef = useRef<HTMLDivElement>(null);
  const committed = useRef<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const force = useRef(false);
  const seen = useRef(new Map<string, Item>());

  const done = () => {
    force.current = true;
    void p.refresh().finally(bump);
  };

  const needle = q.trim().toLowerCase();
  const hit = (...s: string[]) => !needle || s.some((x) => x.toLowerCase().includes(needle));
  let items: Item[] = [];
  if (p.kind === "containers") {
    items = p.containers
      .filter((c) => hit(c.name, c.image))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ id: c.id, name: c.name, node: () => <ContainerRow key={c.id} c={c} rowId={`all-containers-${c.id}`} mode="all" onRemoved={done} /> }));
  } else if (p.kind === "images") {
    items = p.images
      .filter((i) => hit(imageName(i), ...i.tags))
      .sort((a, b) => b.size - a.size)
      .map((i) => ({ id: i.id, name: imageName(i), node: () => <ImageRow key={i.id} i={i} rowId={`all-images-${i.id}`} deletable onDeleted={done} /> }));
  } else {
    items = p.volumes
      .filter((v) => hit(v.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((v) => ({ id: v.name, name: v.name, node: () => <VolumeRow key={v.name} v={v} rowId={`all-volumes-${v.name}`} /> }));
  }
  for (const it of items) seen.current.set(`${p.kind}-${it.id}`, it);

  const el = listRef.current;
  const held = !!el && (el.matches(":hover") || el.contains(document.activeElement));
  const key = `${p.kind}|${needle}`;
  if (force.current || committed.current.key !== key || !held) {
    committed.current = { key, ids: items.map((i) => i.id) };
    force.current = false;
  }
  const rows = committed.current.ids
    .map((id) => seen.current.get(`${p.kind}-${id}`))
    .filter((i): i is Item => !!i);

  const err = p.errors[p.kind];
  const counts = { containers: p.containers.length, images: p.images.length, volumes: p.volumes.length };

  return (
    <section ref={ref} className="dk-all" aria-labelledby="dk-all-h">
      <div className="dk-section-head">
        <h2 id="dk-all-h">Everything</h2>
        <div className="dk-segs" role="group" aria-label="Kind">
          {SEGMENTS.map(({ k, label }) => (
            <SegmentButton key={k} active={p.kind === k} onClick={() => p.onKind(k)}>
              {label} <span className="dk-segn font-mono">{counts[k]}</span>
            </SegmentButton>
          ))}
        </div>
      </div>
      <label className="dk-find">
        <Search size={14} aria-hidden />
        <Input
          type="search"
          aria-label="Find a container, image or volume"
          placeholder="Find a container, image or volume"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div ref={listRef} className="panel dk-all-list" onPointerLeave={bump} onBlur={bump}>
        {err ? (
          <p className="dk-empty">Couldn&apos;t read {p.kind}: {err}</p>
        ) : rows.length ? (
          <FoldList items={rows} grouping={p.kind === "containers"} noun="containers" render={(id) => rows.find((r) => r.id === id)?.node()} />
        ) : (
          <p className="dk-empty">
            {needle
              ? `Nothing matches "${q.trim()}".`
              : p.kind === "volumes"
                ? "No named volumes. App data lives in bind mounts."
                : `No ${p.kind} on this host.`}
          </p>
        )}
      </div>
    </section>
  );
});
