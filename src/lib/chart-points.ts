// Pure point math for components/charts.tsx Sparkline. Relative imports only, so node:test can load this file.

/** Polyline and area points for a W x H box, or null (show "collecting…") when fewer than 2 samples are finite.
 *  A `max` that is not a positive finite number falls back to the data peak, as an undefined `max` does. */
export function sparkPaths(data: number[], max: number | undefined, W: number, H: number) {
  const vals = data.filter(Number.isFinite);
  if (vals.length < 2) return null;
  const peak = max !== undefined && Number.isFinite(max) && max > 0 ? max : Math.max(...vals, 1);
  const line = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      const y = H - 3 - (Math.min(v, peak) / peak) * (H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return { line, area: `0,${H} ${line} ${W},${H}` };
}
