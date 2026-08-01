"use client";

/**
 * /hermes's client hooks: status polls ~10s (Hermes' own loops run on the
 * order of minutes, so anything faster buys nothing), activity ~30s (a log,
 * not a live figure), and job polling is opt-in and fast — the same
 * watch-only-while-running shape disk-scan-jobs.tsx's useScanJob uses,
 * except the job lives on the Hermes daemon rather than a local job store.
 *
 * useHermesRun bundles "start a run, remember its jobId, poll it" into one
 * slot. Every call site (the actions row's digest/alert-test buttons, the Ask
 * panel) owns its own slot — the daemon's own /run contract 409s when a run
 * is already in flight, so there is nothing to coordinate client-side beyond
 * surfacing that 409 honestly.
 */

import { useCallback, useState } from "react";
import useSWR from "swr";
import { ApiError, fetcher, postJson } from "@/lib/client";
import type {
  HermesActivityResponse,
  HermesJob,
  HermesJobKind,
  HermesStatusResponse,
} from "@/lib/hermes-types";

const STATUS_KEY = "/api/hermes-ctl/status";
const ACTIVITY_KEY = "/api/hermes-ctl/activity";

export function useHermesStatus(refreshMs = 10000) {
  return useSWR<HermesStatusResponse>(STATUS_KEY, fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

export function useHermesActivity(refreshMs = 30000) {
  return useSWR<HermesActivityResponse>(ACTIVITY_KEY, fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

export type HermesJobFetch =
  | { ok: true; job: HermesJob }
  | { ok: false; status: string; detail: string };

function jobKey(id: string): string {
  return `/api/hermes-ctl/jobs/${encodeURIComponent(id)}`;
}

/** Polls a specific job at ~2s while it's running, stops once settled. */
export function useHermesJob(jobId: string | null) {
  return useSWR<HermesJobFetch>(jobId ? jobKey(jobId) : null, fetcher, {
    refreshInterval: (latest) => (latest?.ok && latest.job.state === "running" ? 2000 : 0),
    revalidateOnFocus: false,
  });
}

export interface UseHermesRunResult {
  jobId: string | null;
  job: HermesJobFetch | undefined;
  starting: boolean;
  startError: string | null;
  start: (kind: HermesJobKind, question?: string) => Promise<void>;
  reset: () => void;
}

export function useHermesRun(): UseHermesRunResult {
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const { data: job } = useHermesJob(jobId);

  const start = useCallback(async (kind: HermesJobKind, question?: string) => {
    setStarting(true);
    setStartError(null);
    try {
      const body = (await postJson(
        "/api/hermes-ctl/run",
        question !== undefined ? { kind, question } : { kind },
      )) as { jobId: string };
      setJobId(body.jobId);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "could not start run");
    } finally {
      setStarting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setJobId(null);
    setStartError(null);
  }, []);

  return { jobId, job, starting, startError, start, reset };
}

export type { HermesActivityItem, HermesActivityKind, HermesJob, HermesJobKind, HermesStatusOk } from "@/lib/hermes-types";
