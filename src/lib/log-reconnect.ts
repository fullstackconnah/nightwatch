/** Import-free decisions for re-subscribing a log track after its stream ended. */

/** About two minutes of trying (1+2+4+8+16+30+30+30 s) before showing the ended state. */
export const MAX_RECONNECT_ATTEMPTS = 8;

/** Thrown by the server when a name matches no container; the client retries on it during a recreate. */
export const UNKNOWN_CONTAINER = "unknown container";

/**
 * docker reports a follow stream live for a moment even for a container that is
 * already stopped, then ends it. A track live for less than this before ending
 * was never really running, so it is not retried.
 */
export const MIN_LIVE_MS = 2_000;

/** A track live this long before ending stayed up, so its attempts start over. */
export const SETTLED_MS = 30_000;

/** Backoff for the Nth retry (0-based): 1 s, 2 s, 4 s ... capped at 30 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/**
 * Whether a track state means "the container restarted, try again": the follow
 * stream ended, or the name was briefly unknown during a recreate. Only a track
 * that ran (live for at least MIN_LIVE_MS) or one already being retried counts,
 * so a container stopped or removed before the page opened ends at once.
 * `liveForMs` is how long the track was live on this stream, null if never.
 */
export function shouldRetry(
  status: string,
  detail: string | null,
  attempts: number,
  liveForMs: number | null,
): boolean {
  if (attempts >= MAX_RECONNECT_ATTEMPTS) return false;
  if (status !== "ended" && !(status === "error" && detail === UNKNOWN_CONTAINER)) return false;
  return attempts > 0 || (liveForMs !== null && liveForMs >= MIN_LIVE_MS);
}

/** Attempts to count for a track that just left live: 0 once it stayed live SETTLED_MS. */
export function attemptsSoFar(attempts: number, liveForMs: number | null): number {
  return liveForMs !== null && liveForMs >= SETTLED_MS ? 0 : attempts;
}

/** Older resume points fall back to the normal tail instead of asking docker for the whole log. */
const RESUME_MAX_AGE_MS = 3_600_000;

/**
 * Parses `resume=name:lastTs,...`. Only now - 1 h < ts <= now is kept: a 0, missing or ancient ts
 * would make docker read the whole log, and a future one can replay nothing.
 */
export function parseResume(raw: string | null, now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of (raw ?? "").split(",")) {
    const p = part.trim();
    const i = p.lastIndexOf(":");
    const ts = Number(p.slice(i + 1));
    if (i > 0 && ts > 0 && ts > now - RESUME_MAX_AGE_MS && ts <= now) out.set(p.slice(0, i), ts);
  }
  return out;
}

const boot = Date.now().toString(36);
let reads = 0;

/**
 * Id prefix for one log read: `s` seed, `r` resume replay, `l` live feed. The
 * server start time plus a per-process counter make every read's prefix unique,
 * so ids never repeat across reads, new feeds or a server restart, while the
 * client keeps its buffer (and React keys and seen-ids) across all of them.
 */
export function readIdPrefix(source: "s" | "r" | "l"): string {
  return `${source}${boot}.${(reads++).toString(36)}.`;
}
