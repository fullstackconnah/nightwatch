// Pure Home Assistant rules shared by the server client (ha.ts, ha-doorbell.ts) and the client UI.
import type { HaLockState } from "./types/ha.ts";

/** Nearest half-degree: HA climate entities routinely reject arbitrary float precision. */
export const roundHalf = (n: number): number => Math.round(n * 2) / 2;

/** The optimistic target after a nudge, on the same half-degree grid the server writes. */
export const nudgedTemp = (target: number, delta: number): number => roundHalf(target + delta);

export const isUnavailable = (state: string): boolean => state === "unavailable" || state === "unknown";

const KNOWN_LOCK_STATES: readonly string[] = ["locked", "unlocked", "locking", "unlocking", "open", "opening", "jammed", "unavailable", "unknown"];

/** An unrecognised or unknown lock state is not available, so its buttons stay off. */
export function lockState(raw: string): { state: HaLockState; available: boolean } {
  const state = (KNOWN_LOCK_STATES.includes(raw) ? raw : "unknown") as HaLockState;
  return { state, available: !isUnavailable(state) };
}

/** A fired time further ahead of the server clock than this is clock skew or bad data, not an event. */
export const DOORBELL_MAX_FUTURE_SKEW_S = 60;

/** Seconds since the doorbell fired; small future skew reads as 0, a far-future time as no event (null). */
export function doorbellAgeSec(firedMs: number, serverNow: number): number | null {
  if (!Number.isFinite(firedMs)) return null;
  const age = Math.round((serverNow - firedMs) / 1000);
  return age < -DOORBELL_MAX_FUTURE_SKEW_S ? null : Math.max(0, age);
}
