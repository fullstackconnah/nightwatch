// The only source of compare-series colour and dash (resources redesign, shape brief s5).
// Accent vs blue alone fails the normal-vision floor, so identity is dash + end label + legend.
export interface SeriesSlot {
  stroke: string;
  /** SVG stroke-dasharray; undefined = solid. */
  dash: string | undefined;
}

export const SERIES_SLOTS: readonly SeriesSlot[] = [
  { stroke: "var(--color-accent)", dash: undefined },
  { stroke: "var(--color-blue)", dash: undefined },
  { stroke: "var(--color-accent)", dash: "5 4" },
  { stroke: "var(--color-blue)", dash: "5 4" },
  { stroke: "var(--color-accent)", dash: "1.5 3" },
];

/** Colour follows the entity: survivors keep their prior slot, a new id takes the lowest free
 *  slot at or above `first` (1 on resource history where the host holds 0). Wraps if over-full. */
export function assignSlots(ids: string[], prior: ReadonlyMap<string, number>, first: number): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const id of ids) {
    const s = prior.get(id);
    if (s !== undefined && !used.has(s)) {
      out.set(id, s);
      used.add(s);
    }
  }
  for (const id of ids) {
    if (out.has(id)) continue;
    let s = first;
    while (used.has(s) && s < SERIES_SLOTS.length) s++;
    if (s >= SERIES_SLOTS.length) s = first;
    out.set(id, s);
    used.add(s);
  }
  return out;
}

/** Y positions for direct end labels: a downward pass pushes overlaps apart, an upward pass from
 *  the floor pulls them back, all within [6, H-6]. If they can't fit `gap` apart, spread evenly.
 *  Returns new ys in input order. */
export function layoutEndLabels(ys: number[], H: number, gap: number): number[] {
  const lo = 6;
  const hi = H - 6;
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
  const out = new Array<number>(ys.length);
  if (ys.length > 1 && (ys.length - 1) * gap > hi - lo) {
    order.forEach((idx, k) => (out[idx] = lo + (k * (hi - lo)) / (ys.length - 1)));
    return out;
  }
  const v = order.map((i) => Math.min(Math.max(ys[i], lo), hi));
  for (let k = 1; k < v.length; k++) v[k] = Math.max(v[k], v[k - 1] + gap);
  for (let k = v.length - 1; k >= 0; k--) v[k] = Math.min(v[k], k === v.length - 1 ? hi : v[k + 1] - gap);
  order.forEach((idx, k) => (out[idx] = v[k]));
  return out;
}
