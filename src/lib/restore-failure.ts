import { ApiError } from "./api-error.ts";

export const RESTORE_STILL_RUNNING = "The restore may still be running. Check again in a few minutes.";

/** A gateway timeout (ours, or the proxy's 524) means the restore may carry on. A 502 means the manager refused, was down or failed, so it did not run or failed. */
export function restoreSoftFailure(e: unknown): string | null {
  return e instanceof ApiError && [504, 524].includes(e.status) ? RESTORE_STILL_RUNNING : null;
}
