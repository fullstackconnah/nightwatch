/** Pure Timeline logic for /resources (no `@/` imports, no JSX, no enum). */

export type ResourcesView = "watch" | "timeline";

type Range = "live" | "1h" | "24h" | "7d";
export const RANGE_SHORT: Record<Range, string> = { live: "60 s", "1h": "1H", "24h": "24H", "7d": "7D" };
export const RANGE_WORD: Record<Range, string> = { live: "last 60 s", "1h": "last hour", "24h": "last 24 hours", "7d": "last 7 days" };

export function parseView(v: unknown): ResourcesView {
  return v === "timeline" ? "timeline" : "watch";
}

export interface StackInput {
  /** Box value per bucket; null = gap. */
  host: (number | null)[];
  /** Sum of every container per bucket (null is treated as the picks' own sum). */
  containersTotal: (number | null)[];
  /** Charted picks in SLOT order (never rank order); null = no data, stacks as 0. */
  picks: (number | null)[][];
}

export type Band = [lo: number, hi: number];

export interface Stack {
  picks: Band[][];
  rest: Band[];
  other: Band[];
  /** Top of the stack per bucket. */
  top: number[];
  gap: boolean[];
}

/** Bottom up: picks, `rest of containers`, `host & other`. Rest and other clamp at 0
 *  when the containers sum above the host (sampling skew). */
export function stackLayers({ host, containersTotal, picks }: StackInput): Stack {
  const out: Stack = { picks: picks.map(() => []), rest: [], other: [], top: [], gap: [] };
  for (let i = 0; i < host.length; i++) {
    const h = host[i];
    out.gap.push(h === null);
    let base = 0;
    picks.forEach((p, j) => {
      const v = p[i] ?? 0;
      out.picks[j].push([base, base + v]);
      base += v;
    });
    const all = containersTotal[i] ?? base;
    const rest = Math.max(0, all - base);
    out.rest.push([base, base + rest]);
    base += rest;
    const other = Math.max(0, (h ?? 0) - all);
    out.other.push([base, base + other]);
    base += other;
    out.top.push(base);
  }
  return out;
}

const CROSS = 1.05; // a strip passes its neighbour only by more than 5%

/** Strip order: a changed id set re-sorts by average; otherwise the previous order holds
 *  and neighbours swap only when the lower one beats the upper by more than 5%. */
export function holdNearTies(prev: readonly string[], avg: ReadonlyMap<string, number>): string[] {
  const ids = [...avg.keys()];
  const same = ids.length === prev.length && prev.every((id) => avg.has(id));
  if (!same) return ids.sort((a, b) => avg.get(b)! - avg.get(a)!);
  const out = [...prev];
  for (let moved = true; moved; ) {
    moved = false;
    for (let i = 0; i + 1 < out.length; i++) {
      if (avg.get(out[i + 1])! > avg.get(out[i])! * CROSS) {
        [out[i], out[i + 1]] = [out[i + 1], out[i]];
        moved = true;
      }
    }
  }
  return out;
}

const MAX_PICKS = 4;

/** Toggle `id` in the picks. With no picks (auto mode) the auto top 4 is adopted first:
 *  untick leaves 3, tick of an uncharted id replaces auto[3]. Never more than 4; an
 *  empty result means back to auto. */
export function adoptPick(auto: readonly string[], picks: readonly string[], id: string): string[] {
  if (picks.length === 0) {
    const a = auto.slice(0, MAX_PICKS);
    if (a.includes(id)) return a.filter((x) => x !== id);
    return a.length >= MAX_PICKS ? [...a.slice(0, MAX_PICKS - 1), id] : [...a, id];
  }
  if (picks.includes(id)) return picks.filter((x) => x !== id);
  return picks.length >= MAX_PICKS ? [...picks] : [...picks, id];
}

/** The live edge at 1H. `ts` is each bucket's START (emitBuckets in metrics-history.ts),
 *  so a bucket is [t, t+widthMs). Buckets the ring covers from their start, up to and
 *  including the current partial one, are recomputed from the ring's mean. 24H and 7D
 *  are never overridden: a 60 s mean would replace a multi-minute one. */
export function ringTail(
  values: readonly (number | null)[],
  ts: readonly number[],
  ring: readonly { ts: number; v: number }[],
  widthMs: number,
  range: "1h" | "24h" | "7d",
): (number | null)[] {
  const out = [...values];
  if (range !== "1h" || ring.length === 0) return out;
  const from = ring[0].ts;
  const last = ring[ring.length - 1].ts;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t < from || t > last) continue;
    let sum = 0;
    let n = 0;
    for (const r of ring) {
      if (r.ts >= t && r.ts < t + widthMs) {
        sum += r.v;
        n++;
      }
    }
    if (n) out[i] = sum / n;
  }
  return out;
}

/** Range averages for strip order and the auto top 4: only containers in the CURRENT list.
 *  The 7D summary holds hundreds of gone (runner) names; those live on in the chart only
 *  through containersTotal (the rest layer). Names with no summary entry are left out. */
export function rangeAvgs(
  summary: Readonly<Record<string, { avg: number }>>,
  current: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const name of current) if (summary[name]) out.set(name, summary[name].avg);
  return out;
}
