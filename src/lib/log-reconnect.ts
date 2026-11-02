/** Import-free decisions for re-subscribing a log track after its stream ended. */

/** About two minutes of trying (1+2+4+8+16+30+30+30 s) before showing the ended state. */
export const MAX_RECONNECT_ATTEMPTS = 8;

/** Backoff for the Nth retry (0-based): 1 s, 2 s, 4 s ... capped at 30 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/**
 * Whether a track state means "the container restarted, try again": the follow
 * stream ended, or the name was briefly unknown during a recreate. Other errors
 * and spent attempts stay as they are, so a stopped or removed container ends.
 */
export function shouldRetry(status: string, detail: string | null, attempts: number): boolean {
  if (attempts >= MAX_RECONNECT_ATTEMPTS) return false;
  return status === "ended" || (status === "error" && detail === "unknown container");
}
