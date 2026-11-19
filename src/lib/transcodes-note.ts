export const TRANSCODES_NOTE_COPY = {
  // Fixed on purpose: the raw error can name a host.
  detail: "The dashboard didn't answer.",
  stale: "Sessions may be out of date; the last refresh failed.",
} as const;

/** "load": failed with nothing held; "stale": failed but SWR kept the last answer. */
export function transcodeNote({ txError, tx }: { txError: boolean; tx: unknown }): "load" | "stale" | null {
  if (!txError) return null;
  return tx === undefined ? "load" : "stale";
}
