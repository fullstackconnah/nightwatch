// Pure band maths for /resources (resources redesign, PR2). No imports: node:test cannot resolve the @/ alias.

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

/** Scale steps: the band's chart y-axis and (PR3) the watchlist bars snap up to these. */
export const CPU_STEPS: readonly number[] = [1, 2, 5, 10, 25, 50, 100];
export const MEM_STEPS: readonly number[] = [256 * MiB, 512 * MiB, GiB, 2 * GiB, 4 * GiB, 8 * GiB, 16 * GiB];

/** Smallest step at or above `v`; a value over the top step clamps to the top step. */
export function snapScale(v: number, steps: readonly number[]): number {
  return steps.find((s) => v <= s) ?? steps[steps.length - 1];
}

export interface BandParts {
  base: number;
  /** containers, host & other, idle (or free). Always sums to `base`. */
  parts: [number, number, number];
}

const fin = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);

function split(base: number, used: number, containers: number): BandParts {
  const c = Math.min(containers, base);
  const o = Math.min(Math.max(0, used - containers), base - c); // clamps at 0 when containers exceed the host
  return { base, parts: [c, o, base - c - o] };
}

/** CPU: both numbers are percent of the whole box, so containers need no scaling. */
export function cpuBand(hostCpuPct: number, containerCpuPcts: number[]): BandParts {
  return split(100, fin(hostCpuPct), fin(containerCpuPcts.reduce((a, v) => a + fin(v), 0)));
}

export function memBand(memUsed: number, memTotal: number, containerBytes: number[]): BandParts {
  return split(fin(memTotal), fin(memUsed), fin(containerBytes.reduce((a, v) => a + fin(v), 0)));
}

// ---- PR3: the calm ranker and the watch / quiet / stopped split ----

export const RANK_GAP_MS = 4000;
export const WATCH_MAX = 10;
/** Owner decision 5: a running container below this share of the box is quiet. */
export const QUIET_CPU = 0.05;

const QUIET_CPU_STEPS: readonly number[] = [QUIET_CPU, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];
const QUIET_MEM_STEPS: readonly number[] = [16 * MiB, 32 * MiB, 64 * MiB, 128 * MiB, 256 * MiB, 512 * MiB, GiB];

/** Keeps a held order; commits a new one at most every `gap` ms and never while held (shape brief s3). */
export class Ranker {
  private current: string[] | null = null;
  private last = -Infinity;
  private waiting = false;
  private readonly gap: number;
  constructor(gap: number) {
    this.gap = gap;
  }
  get order(): readonly string[] | null {
    return this.current;
  }
  /** A different order is waiting for the hold to lift or the gap to pass. */
  get pending(): boolean {
    return this.waiting;
  }
  /** True when `ids` became the committed order. The first offer always commits. */
  offer(ids: readonly string[], now: number, held: boolean): boolean {
    const cur = this.current;
    const same = cur !== null && cur.length === ids.length && cur.every((x, i) => x === ids[i]);
    if (cur === null || (!same && !held && now - this.last >= this.gap)) {
      this.current = ids.slice();
      this.last = now;
      this.waiting = false;
      return true;
    }
    this.waiting = !same;
    return false;
  }
}

export const createRanker = (gap = RANK_GAP_MS) => new Ranker(gap);

export interface WatchItem {
  id: string;
  name: string;
  running: boolean;
  /** CPU percent of the box or memory bytes; null when there is no telemetry row. */
  value: number | null;
}

export interface WatchSplit {
  /** Busiest first, at most WATCH_MAX. */
  watch: string[];
  /** Running with a row, not in watch. By name. */
  quiet: string[];
  /** Stopped, or running with no telemetry row. By name. */
  stopped: string[];
}

export function splitWatch(items: readonly WatchItem[], kind: "cpu" | "mem"): WatchSplit {
  const byName = (a: WatchItem, b: WatchItem) => a.name.localeCompare(b.name);
  const ranked = items
    .filter((i) => i.running && i.value != null)
    .sort((a, b) => (b.value as number) - (a.value as number) || byName(a, b));
  const eligible = kind === "cpu" ? ranked.filter((i) => (i.value as number) >= QUIET_CPU) : ranked;
  const watch = eligible.slice(0, WATCH_MAX);
  const inWatch = new Set(watch);
  return {
    watch: watch.map((i) => i.id),
    quiet: ranked.filter((i) => !inWatch.has(i)).sort(byName).map((i) => i.id),
    stopped: items.filter((i) => !i.running || i.value == null).sort(byName).map((i) => i.id),
  };
}

/** Smallest cap strictly above the largest quiet value ("each under {cap}"); clamps to the top step. */
export function quietCap(kind: "cpu" | "mem", quietMax: number): number {
  const steps = kind === "cpu" ? QUIET_CPU_STEPS : QUIET_MEM_STEPS;
  return steps.find((s) => quietMax < s) ?? steps[steps.length - 1];
}
