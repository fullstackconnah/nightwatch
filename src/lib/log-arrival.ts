/**
 * Pure decisions behind a log track's arrival handling, split out of the
 * component so node:test can reach them (the component imports through `@/`).
 */

/** Ids in `view` that have not yet been announced or animated. Nothing before the seed latched. */
export function pickArrived(view: readonly { id: string }[], seen: ReadonlySet<string>, seeded: boolean): Set<string> {
  const arrived = new Set<string>();
  if (!seeded) return arrived;
  for (const l of view) if (!seen.has(l.id)) arrived.add(l.id);
  return arrived;
}

/**
 * How many lines landed after `prevLastId`. Counts by identity, not length: a
 * full ring buffer keeps a constant length while old lines drop off the front.
 * If the previous last line has itself dropped out, every line is new.
 */
export function countNewLines(prevLastId: string | undefined, lines: readonly { id: string }[]): number {
  if (lines.length === 0) return 0;
  if (prevLastId === undefined) return lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].id === prevLastId) return lines.length - 1 - i;
  }
  return lines.length;
}
