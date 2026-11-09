/** A commit with no author date stays null so the UI shows a dash, never the 1970 epoch. */
export const commitDate = (d: string | undefined): string | null => d || null;

/** Missing or unparseable (NaN) dates rank oldest, so the sort stays a strict weak order. */
const rank = (d: string | null): number => (d ? Date.parse(d) : NaN) || -Infinity;

/** Newest first; null and unparseable dates last. */
export const newestFirst = (a: { date: string | null }, b: { date: string | null }): number =>
  (rank(b.date) - rank(a.date)) || 0;
