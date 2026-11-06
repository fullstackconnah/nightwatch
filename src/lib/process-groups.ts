// Pure grouping, filter and ordering for the ALL tab (resources redesign, PR4). No imports: node:test cannot resolve the @/ alias.

export interface PLike {
  pid: number;
  comm: string;
  cmdline: string | null;
  cpuPct: number | null;
  rssBytes: number;
  threads: number;
  containerId: string | null;
  containerName: string | null;
  cgroupIoRate: number | null;
}

export type GroupSort = "cpu" | "mem";
export const OTHER_ID = "__other__";
export const OTHER_NAME = "other · not in a container";
/** Processes listed under an open group. */
export const PROC_CAP = 12;

export interface Group<P extends PLike = PLike> {
  id: string;
  name: string;
  other: boolean;
  procs: P[];
  /** Sum of measured process cpu; null when none is measured yet (not idle, not zero). */
  cpu: number | null;
  mem: number;
  threads: number;
  /** Container cgroup rate, taken once (every process reports the same figure). null for "other". */
  io: number | null;
}

export function buildGroups<P extends PLike>(processes: readonly P[]): Group<P>[] {
  const map = new Map<string, Group<P>>();
  for (const p of processes) {
    const id = p.containerId ?? OTHER_ID;
    let g = map.get(id);
    if (!g) {
      g = { id, name: p.containerId ? (p.containerName ?? p.containerId.slice(0, 12)) : OTHER_NAME, other: !p.containerId, procs: [], cpu: null, mem: 0, threads: 0, io: p.cgroupIoRate };
      map.set(id, g);
    }
    // Names resolve from a cached docker lookup, so the first process can arrive before its name does.
    if (p.containerId && p.containerName && g.name === p.containerId.slice(0, 12)) g.name = p.containerName;
    g.procs.push(p);
    if (p.cpuPct != null) g.cpu = (g.cpu ?? 0) + p.cpuPct;
    g.mem += p.rssBytes;
    g.threads += p.threads;
    if (g.io == null && p.cgroupIoRate != null) g.io = p.cgroupIoRate;
  }
  return [...map.values()];
}

/** `q` is already trimmed and lowercased. Container name, comm, cmdline, and an exact pid. */
export function processMatches(p: PLike, q: string): boolean {
  return (
    String(p.pid) === q ||
    p.comm.toLowerCase().includes(q) ||
    (p.cmdline ?? "").toLowerCase().includes(q) ||
    (p.containerName ?? "").toLowerCase().includes(q)
  );
}

/** Groups that match, in the order given. An empty query keeps every group. */
export function filterGroups<P extends PLike>(groups: readonly Group<P>[], query: string): Group<P>[] {
  const q = query.trim().toLowerCase();
  return q ? groups.filter((g) => g.name.toLowerCase().includes(q) || g.procs.some((p) => processMatches(p, q))) : [...groups];
}

const num = (g: Group, sort: GroupSort) => (sort === "cpu" ? g.cpu : g.mem);

/** Group ids, biggest first by the key; unmeasured cpu last; ties by name so equal values hold their order. */
export function rankedIds(groups: readonly Group[], sort: GroupSort): string[] {
  return [...groups]
    .sort((a, b) => (num(b, sort) ?? -1) - (num(a, sort) ?? -1) || a.name.localeCompare(b.name))
    .map((g) => g.id);
}

/** The processes an open group lists: all of them when the group's name matched, else only the hits. */
export function topProcs<P extends PLike>(g: Group<P>, query: string, sort: GroupSort, n = PROC_CAP): P[] {
  const q = query.trim().toLowerCase();
  const pool = q && !g.name.toLowerCase().includes(q) ? g.procs.filter((p) => processMatches(p, q)) : g.procs;
  const key = (p: P) => (sort === "cpu" ? p.cpuPct : p.rssBytes);
  return [...pool].sort((a, b) => (key(b) ?? -1) - (key(a) ?? -1) || a.pid - b.pid).slice(0, n);
}

/** A held order keeps its places but still lists groups that newly match; ids no longer ranked drop out. */
export function withNewcomers(order: readonly string[] | null, ranked: readonly string[]): string[] {
  const now = new Set(ranked);
  const kept = (order ?? []).filter((id) => now.has(id));
  const have = new Set(kept);
  return [...kept, ...ranked.filter((id) => !have.has(id))];
}
