"use client";

import useSWR, { mutate as globalMutate } from "swr";
import { fetcher, postJson } from "@/lib/client";
import type { GitSnapshot } from "@/lib/forgejo-types";

const GIT_KEY = "/api/git";

/** 60s: a commit/PR/mirror stream from a homelab's own repos moves slowly —
 *  nowhere near the 5s cadence container stats need — so this matches the
 *  spec's "SWR ~60s poll" rather than the dashboard's faster live surfaces. */
export function useGit(refreshMs = 60000) {
  return useSWR<GitSnapshot>(GIT_KEY, fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

/**
 * Triggers a force-sync on one repo's push mirror. Forgejo runs the actual
 * sync asynchronously on its own side, so this promise resolving only means
 * "Forgejo accepted the request" — it revalidates the /api/git cache (server
 * cache is also busted on success, see forgejo.ts) so the next poll can pick
 * up a fresher lastSync/lastError once the job actually lands.
 */
export async function syncMirror(owner: string, repo: string): Promise<void> {
  await postJson("/api/git/sync", { owner, repo });
  await globalMutate(GIT_KEY);
}
