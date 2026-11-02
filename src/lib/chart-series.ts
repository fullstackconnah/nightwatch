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
