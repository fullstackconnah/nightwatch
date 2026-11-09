type JobRead =
  | { ok: false; status: string; detail: string }
  | { ok: true; job: { state: string; error?: string | null; result?: { body?: string | null } | null } };

export type Settle =
  | { kind: "wait" }
  | { kind: "answer"; answer: string }
  | { kind: "error"; error: string; keepActive: boolean };

/** What a polled job means for the active exchange; an unreadable poll keeps it active because SWR keeps retrying. */
export function settleExchange(read: JobRead): Settle {
  if (!read.ok) return { kind: "error", error: "Could not read the answer from Hermes — try again.", keepActive: true };
  const { job } = read;
  if (job.state === "done") return { kind: "answer", answer: job.result?.body ?? "" };
  if (job.state === "error") return { kind: "error", error: job.error ?? "Hermes reported an error.", keepActive: false };
  return { kind: "wait" };
}

/** True from the start POST until the job settles, so a second question cannot slip into the gaps before the first poll. */
export function isAsking(run: { starting: boolean; jobId: string | null | undefined; job: { ok: boolean; job?: { state: string } } | undefined }): boolean {
  return run.starting || (Boolean(run.jobId) && !run.job) || (!!run.job?.ok && run.job.job?.state === "running");
}
