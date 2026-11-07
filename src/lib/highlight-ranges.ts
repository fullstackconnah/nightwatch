/**
 * Search-highlight offsets for a line made of colour segments. The pattern runs
 * once over the joined text, so `^` anchors the line start and a match may span
 * a colour boundary; the result maps each match back to per-segment [start, end)
 * ranges local to that segment. Import-free so node:test can load it.
 */
export function highlightRanges(texts: string[], highlight: RegExp | null | undefined): [number, number][][] {
  const out: [number, number][][] = texts.map(() => []);
  if (!highlight) return out;
  const joined = texts.join("");
  if (joined.length === 0) return out;
  // Fresh g-flagged clone: never mutate the caller's regex or trust its lastIndex.
  const re = new RegExp(highlight.source, highlight.flags.includes("g") ? highlight.flags : highlight.flags + "g");
  const starts: number[] = [];
  let at = 0;
  for (const t of texts) {
    starts.push(at);
    at += t.length;
  }
  let first = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex = m.index + 1; // an empty match marks nothing and must not spin
      continue;
    }
    const from = m.index;
    const to = from + m[0].length;
    // Matches arrive in order, so `first` only moves forward past segments that end before this match.
    while (first < texts.length && starts[first] + texts[first].length <= from) first++;
    for (let i = first; i < texts.length && starts[i] < to; i++) {
      const s = Math.max(from, starts[i]);
      const e = Math.min(to, starts[i] + texts[i].length);
      if (e > s) out[i].push([s - starts[i], e - starts[i]]);
    }
  }
  return out;
}
