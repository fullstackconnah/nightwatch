/** Container detail page decisions, kept pure so node:test can reach them. */

export const REFRESH_FAILED = "Couldn't refresh. Showing the last update.";
export const LOAD_FAILED = "Couldn't load this container. Retrying.";
export const LOGS_FAILED = "Couldn't read logs.";

/** "not-found" only for a real 404; any other failure keeps the page and gets one line (or null when fine). */
export function detailNotice(error: unknown, hasData: boolean): "not-found" | string | null {
  if (!error) return null;
  if ((error as { status?: number }).status === 404) return "not-found";
  return hasData ? REFRESH_FAILED : LOAD_FAILED;
}

/** A stopped container has no live samples; drop the old history so the header falls back to "—". */
export function statsWhileRunning<T>(history: T[], running: boolean): T[] {
  return running ? history : [];
}

/** Was the view already at (within px of) the bottom? Read before the update lands. */
export function nearBottom(m: { scrollHeight: number; scrollTop: number; clientHeight: number }, px = 32): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= px;
}
