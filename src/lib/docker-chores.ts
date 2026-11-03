/* Pure logic for /docker (the clean-up list). Relative imports only so node:test can load it (no "@/" alias).
   Rules R2 (order), R4 (held membership) and the honest states (C12) live here; the components only draw. */
import { formatBytes } from "./format.ts";
import { gate } from "./home.ts";

export interface ImageItem {
  id: string;
  tags: string[];
  size: number;
  created: number;
  inUse: boolean;
  usedBy: string[];
  stack: string | null;
}
export interface ContainerItem {
  id: string;
  name: string;
  state: string;
  composeProject: string | null;
  created: number;
}
export interface ReclaimLike {
  images: { dangling: { id: string }[]; danglingBytes: number };
  volumes: { orphans: { name: string; size: number | null }[]; orphanBytes: number };
  buildCacheBytes: number | null;
  totals: { reclaimableBytes: number };
}
export interface ChoreInput {
  reclaim: ReclaimLike;
  images: ImageItem[];
  containers: ContainerItem[];
  volumes: unknown[];
}

export type ChoreId = "dangling" | "orphans" | "unused" | "stopped" | "cache";
export interface Chore {
  id: ChoreId;
  /** prune: one-tap prune; review: row-by-row; cache: read-only. */
  kind: "prune" | "review" | "cache";
  title: string;
  note: string;
  count: number;
  /** null while sizes are unknown or the chore has no bytes. */
  bytes: number | null;
  memberIds: string[];
}

export const STOPPED_STATES: readonly string[] = ["created", "exited", "dead"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Tagged, not in use. Not `images.unusedBytes`: that one also counts dangling images. */
export function unusedTaggedBytes(images: readonly ImageItem[]): number {
  return images.reduce((a, i) => (!i.inUse && i.tags.length ? a + i.size : a), 0);
}

export function heroBytes(reclaim: ReclaimLike, sizesPending: boolean): { bytes: number; plus: boolean } {
  return { bytes: reclaim.totals.reclaimableBytes, plus: sizesPending };
}

export function buildChores({ reclaim, images, containers }: ChoreInput): Chore[] {
  const unused = images.filter((i) => !i.inUse && i.tags.length).sort((a, b) => b.size - a.size);
  const stopped = containers.filter((c) => STOPPED_STATES.includes(c.state));
  const orphans = reclaim.volumes.orphans;
  const sizing = orphans.some((o) => o.size == null);
  return [
    {
      id: "dangling", kind: "prune", title: "Dangling images",
      note: `${plural(reclaim.images.dangling.length, "untagged layer")} no container uses`,
      count: reclaim.images.dangling.length, bytes: reclaim.images.danglingBytes,
      memberIds: reclaim.images.dangling.map((i) => i.id),
    },
    {
      id: "orphans", kind: "prune", title: "Orphan volumes",
      note: `${plural(orphans.length, "named volume")} no container mounts`,
      count: orphans.length, bytes: sizing ? null : reclaim.volumes.orphanBytes,
      memberIds: orphans.map((o) => o.name),
    },
    {
      id: "unused", kind: "review", title: "Unused tagged images",
      note: "Review: a stack may pull them again",
      count: unused.length, bytes: unusedTaggedBytes(images), memberIds: unused.map((i) => i.id),
    },
    {
      id: "stopped", kind: "review", title: "Stopped containers",
      note: `${plural(stopped.length, "container")} not running`,
      count: stopped.length, bytes: null, memberIds: stopped.map((c) => c.id),
    },
    {
      id: "cache", kind: "cache", title: "Build cache",
      note: "Clear it with `docker builder prune` on the box",
      count: 0, bytes: reclaim.buildCacheBytes, memberIds: [],
    },
  ];
}

const FIXED: readonly ChoreId[] = ["dangling", "orphans", "unused", "stopped"];

/** R2. Tier 0: prunes with a count, biggest bytes first (null last, then count). Tier 1: unused, stopped. Tier 2: empty ones. Cache last. */
export function choreOrder(chores: readonly Chore[]): Chore[] {
  const by = new Map(chores.map((c) => [c.id, c]));
  const pick = (ids: readonly ChoreId[], f: (c: Chore) => boolean) =>
    ids.map((id) => by.get(id)).filter((c): c is Chore => !!c && f(c));
  const tier0 = pick(FIXED, (c) => c.kind === "prune" && c.count > 0).sort(
    (a, b) => (a.bytes == null ? 1 : 0) - (b.bytes == null ? 1 : 0) || (b.bytes ?? 0) - (a.bytes ?? 0) || b.count - a.count,
  );
  const tier1 = pick(["unused", "stopped"], (c) => c.count > 0);
  const tier2 = pick(FIXED, (c) => c.count === 0);
  return [...tier0, ...tier1, ...tier2, ...pick(["cache"], () => true)];
}

// ---- the hero and the status slot ----

export function heroLine(s: { loading: boolean; diskError: boolean; bytes: number; plus: boolean }): { lead: string; label: string } {
  if (s.loading) return { lead: "Reading Docker…", label: "" };
  if (s.diskError) return { lead: "Can't size it right now", label: "" };
  if (s.bytes === 0 && !s.plus) return { lead: "Nothing can go right now", label: "" };
  return { lead: `${formatBytes(s.bytes, 1)}${s.plus ? "+" : ""}`, label: "can go now" };
}

export interface Src {
  error: string | null;
  loaded: boolean;
}
export interface Sources {
  containers: Src;
  images: Src;
  volumes: Src;
  disk: Src;
  sizesPending: boolean;
  buildCacheBytes: number | null;
  /** Ms since the last good containers read; null before the first one. */
  staleMs: number | null;
  /** "2 min ago" style text for the Docker-down line. */
  agoText: string;
}
export type SlotKind = "error" | "stale" | "sizes" | "cache";
export const STALE_AFTER_MS = 60_000;

/** One item, in priority order. Only Docker being down or the df failing is an error band; one list failing says so inline. */
export function slotItem(s: Sources): { kind: SlotKind; text: string } {
  const down = [s.containers, s.images, s.volumes].every((x) => x.error);
  if (down) {
    return {
      kind: "error",
      text: `${/not reachable|unreachable/i.test(s.containers.error ?? "") ? s.containers.error : `Docker unreachable: ${s.containers.error}`}. ${s.containers.loaded ? `Showing the last list from ${s.agoText}; nothing` : "Nothing"} here can change until it is back.`,
    };
  }
  if (s.disk.error) return { kind: "error", text: `Couldn't size the clean-up: ${s.disk.error}` };
  if (s.staleMs != null && s.staleMs > STALE_AFTER_MS) {
    return {
      kind: "stale",
      text: `Last update ${Math.floor(s.staleMs / 60_000)} min ago. The list may be out of date; actions still check live before they run.`,
    };
  }
  if (s.sizesPending) return { kind: "sizes", text: "Sizes still arriving (Docker takes up to a minute)" };
  return {
    kind: "cache",
    text:
      s.buildCacheBytes == null
        ? "Build cache size isn't reported by the socket proxy."
        : `Build cache ${formatBytes(s.buildCacheBytes, 1)} can't be cleared from here: the socket proxy doesn't allow it (BUILD=0).`,
  };
}

// ---- R4: membership held by a snapshot of ids ----

export function heldMembers(
  snapshot: readonly string[] | null,
  live: readonly string[],
): { rows: string[]; newIds: string[]; goneIds: string[] } {
  const g = gate(snapshot, live);
  return { rows: g.shown, newIds: g.waiting, goneIds: g.fixed };
}

/** R4: the owner's own write takes a fresh snapshot of the chore's members (never null, which would release the hold). */
export function snapAfterWrite<S extends Partial<Record<string, string[] | null>>>(snaps: S, chore: string, latest: readonly string[] | undefined): S {
  return { ...snaps, [chore]: [...(latest ?? [])] };
}

export function pillText(newCount: number, goneCount: number): string {
  if (newCount > 0) return `${newCount} new · show`;
  return goneCount > 0 ? "Update list" : "";
}

// ---- long lists ----

export const FOLD_AT = 12;
export const GROUP_AT = 8;

export function fold(ids: readonly string[], showAll: boolean, limit = FOLD_AT): { shown: string[]; hidden: number } {
  if (showAll || ids.length <= limit) return { shown: ids.slice(), hidden: 0 };
  return { shown: ids.slice(0, limit), hidden: ids.length - limit };
}

/** A name prefix ("odiptest" in "odiptest-run3") shared by `min` or more rows forms a group. */
export function foldGroups(
  items: readonly { id: string; name: string }[],
  min = GROUP_AT,
): { groups: { prefix: string; ids: string[] }[]; rest: string[] } {
  const by = new Map<string, string[]>();
  for (const it of items) {
    const prefix = it.name.includes("-") ? it.name.split("-")[0] : "";
    if (prefix) by.set(prefix, [...(by.get(prefix) ?? []), it.id]);
  }
  const groups = [...by].filter(([, ids]) => ids.length >= min).map(([prefix, ids]) => ({ prefix, ids }));
  const grouped = new Set(groups.flatMap((g) => g.ids));
  return { groups, rest: items.filter((i) => !grouped.has(i.id)).map((i) => i.id) };
}

export type FindKind = "containers" | "images" | "volumes";
export function findKind(v: string | null | undefined): FindKind {
  return v === "images" || v === "volumes" ? v : "containers";
}
