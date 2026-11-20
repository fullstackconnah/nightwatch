import { ApiError } from "../api-error.ts";
import type { HermesJob } from "../types/hermes.ts";

/** How long a voice or page ask may stay "running" on the client clock before we stop waiting. */
export const ASK_DEADLINE_MS = 10 * 60 * 1000;
// Says "stopped waiting", not "cancelled": the daemon may still hold the job (the next ask can get its 409).
export const ASK_TIMEOUT_TEXT = "Hermes has not answered after 10 minutes. Stopped waiting; it may still be working.";

type JobRead = { ok: true; job: HermesJob } | { ok: false; status: string; detail: string };

/** An ask still running (or unread) at the cap becomes a settled error; real answers and failures, and other kinds, pass through. `now` is injected. */
export function askDeadline(read: JobRead | undefined, kind: string | null, startedAtMs: number | null, now: number): JobRead | undefined {
  if (kind !== "ask" || startedAtMs === null || now < startedAtMs + ASK_DEADLINE_MS) return read;
  if (read && !(read.ok && read.job.state === "running")) return read;
  return { ok: true, job: { state: "error", kind: "ask", startedAt: null, finishedAt: null, result: null, error: ASK_TIMEOUT_TEXT } };
}

type Fetch = { ok: true; job: unknown } | { ok: false; status: string; detail: string };

/** What a job poll shows: a failed read when it never succeeded or the session lapsed (401); otherwise the last good reading. */
export function jobView<T extends Fetch>(data: T | undefined, error: unknown): T | Extract<Fetch, { ok: false }> | undefined {
  if (!error || (data && !(error instanceof ApiError && error.status === 401))) return data;
  return { ok: false, status: "error", detail: error instanceof Error ? error.message : "could not read the job" };
}
