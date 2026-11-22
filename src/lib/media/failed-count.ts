// Relative imports with explicit .ts: node --test has no "@/" resolver.
import { isProbeOk } from "../integration-client.ts";
import type { MediaWorkerClient } from "./worker.ts";
import type { Job } from "../../../services/media-worker/src/types.ts";

const WINDOW_MS = 7 * 86_400_000;

/**
 * Paths whose latest job failed within the last 7 days ("latest" per path, like the worker's pruneFinished) and was not dismissed.
 * Any trouble reaching or reading the worker counts as 0: the Media page already says the worker is down,
 * so Home must not nag about it.
 */
export async function countRecentFailedCompressions(client: Pick<MediaWorkerClient, "jobs">, now = Date.now()): Promise<number> {
  try {
    const p = await client.jobs();
    if (!isProbeOk(p)) return 0;
    const { current, queue, recent } = p.data;
    const all: Job[] = [...(current ? [current] : []), ...queue, ...recent];
    const latest = new Map<string, { job: Job; at: number }>();
    for (const job of all) {
      const at = Date.parse(job.createdAt);
      const prev = latest.get(job.path);
      if (!prev || !(at < prev.at)) latest.set(job.path, { job, at }); // ties and unparsable times: the later entry wins
    }
    let n = 0;
    for (const { job } of latest.values()) {
      const t = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
      if (job.state === "failed" && !job.dismissedAt && now - t >= 0 && now - t <= WINDOW_MS) n++;
    }
    return n;
  } catch {
    return 0;
  }
}
