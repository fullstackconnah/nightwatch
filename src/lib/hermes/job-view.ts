import { ApiError } from "../api-error.ts";

type Fetch = { ok: true; job: unknown } | { ok: false; status: string; detail: string };

/** What a job poll shows: a failed read when it never succeeded or the session lapsed (401); otherwise the last good reading. */
export function jobView<T extends Fetch>(data: T | undefined, error: unknown): T | Extract<Fetch, { ok: false }> | undefined {
  if (!error || (data && !(error instanceof ApiError && error.status === 401))) return data;
  return { ok: false, status: "error", detail: error instanceof Error ? error.message : "could not read the job" };
}
