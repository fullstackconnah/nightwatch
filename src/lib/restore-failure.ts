import { ApiError } from "./api-error.ts";

export const RESTORE_STILL_RUNNING = "The restore may still be running. Check again in a few minutes.";

/** A proxy in front of the dashboard gives up (502/504/524) before a long restore ends; the restore carries on. */
export function restoreSoftFailure(e: unknown): string | null {
  return e instanceof ApiError && [502, 504, 524].includes(e.status) ? RESTORE_STILL_RUNNING : null;
}
