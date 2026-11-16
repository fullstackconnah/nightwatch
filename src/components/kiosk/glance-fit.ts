/** How many chips stay visible in a row of `limit` px when the rest fold into one `moreW`-wide "+n" chip.
 *  Everything fitting means no "+n" at all (so the all-fit test ignores `moreW`). Pure so node:test can load it. */
export function fitChips(widths: number[], limit: number, gap: number, moreW: number): number {
  const total = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= limit) return widths.length;
  let used = moreW;
  let k = 0;
  for (const w of widths) {
    used += gap + w;
    if (used > limit) break;
    k++;
  }
  return k;
}

/** How many of the lights folded into the "+n" chip (every light past the first `k`) are on. */
export function foldedOn(lights: { on: boolean }[], k: number): number {
  return lights.slice(k).filter((l) => l.on).length;
}
