/** A lifecycle or remove call that outlived its deadline: the outcome is unknown, so the copy says to check before retrying. */
export const ACTION_TIMEOUT_MESSAGE =
  "Docker didn't answer in time. The action may still have gone through, so check the container before trying again.";
export const REMOVE_TIMEOUT_MESSAGE =
  "Docker didn't answer in time. The removal may still have gone through, so check the container before trying again.";

/** AbortSignal.timeout() through docker-modem surfaces as AbortError / ABORT_ERR (cause: TimeoutError). */
export const isDeadlineError = (e: unknown): boolean => (e as { code?: string } | null)?.code === "ABORT_ERR";
