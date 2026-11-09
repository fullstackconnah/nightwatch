/** A commit with no author date stays null so the UI shows a dash, never the 1970 epoch. */
export const commitDate = (d: string | undefined): string | null => d || null;

/** Newest first; null dates last. */
export const newestFirst = (a: { date: string | null }, b: { date: string | null }): number =>
  (b.date ? Date.parse(b.date) : -Infinity) - (a.date ? Date.parse(a.date) : -Infinity) || 0;
