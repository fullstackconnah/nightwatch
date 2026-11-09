"use client";

/**
 * /hermes's client hooks: status polls ~10s (Hermes' own loops run on the
 * order of minutes, so anything faster buys nothing), activity ~30s (a log,
 * not a live figure), and job polling is opt-in and fast — the same
 * watch-only-while-running shape disk-scan-jobs.tsx's useScanJob uses,
 * except the job lives on the Hermes daemon rather than a local job store.
 *
 * useHermesRun bundles "start a run, remember its jobId, poll it" into one
 * slot. /hermes calls it once and hands the result to Runs and Ask (the daemon
 * runs one job at a time), filtering results by job kind; the voice ask keeps
 * its own, and the daemon's 409 is surfaced honestly.
 */

import { useCallback, useRef, useState } from "react";
import useSWR from "swr";
import { ApiError, fetcher, postJson } from "@/lib/client";
import { jobView } from "@/lib/hermes/job-view";
import type {
  HermesActivityResponse,
  HermesJob,
  HermesJobKind,
  HermesStatusResponse,
} from "@/lib/types/hermes";

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
  const lapsedFor = useRef<string | null>(null);
  return useSWR<HermesJobFetch>(jobId ? jobKey(jobId) : null, fetcher, {
    refreshInterval: (latest) => (jobId !== lapsedFor.current && latest?.ok && latest.job.state === "running" ? 2000 : 0),
    revalidateOnFocus: false,
    // A lapsed session won't recover by retrying or polling; other errors keep SWR's backoff.
    shouldRetryOnError: (e) => !(e instanceof ApiError && e.status === 401),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) lapsedFor.current = jobId;
    },
  });
}

export interface UseHermesRunResult {
  jobId: string | null;
  job: HermesJobFetch | undefined;
  starting: boolean;
  startError: string | null;
  /** The kind last started from this hook, so a failed start or an unreadable job can be filed under Runs or Ask. */
  kind: HermesJobKind | null;
  /** Resolves to the failure text (the daemon's 409 passes through), or null once the run has started. */
  start: (kind: HermesJobKind, question?: string) => Promise<string | null>;
  reset: () => void;
}

export function useHermesRun(): UseHermesRunResult {
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [kind, setKind] = useState<HermesJobKind | null>(null);
  const { data, error } = useHermesJob(jobId);
  const job = jobView(data, error);

  const start = useCallback(async (kind: HermesJobKind, question?: string): Promise<string | null> => {
    setStarting(true);
    setStartError(null);
    setKind(kind);
    try {
      const body = (await postJson(
        "/api/hermes-ctl/run",
        question !== undefined ? { kind, question } : { kind },
      )) as { jobId: string };
      setJobId(body.jobId);
      return null;
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "could not start run";
      setStartError(message);
      return message;
    } finally {
      setStarting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setJobId(null);
    setStartError(null);
  }, []);

  return { jobId, job, starting, startError, kind, start, reset };
}

export type { HermesActivityItem, HermesActivityKind, HermesJob, HermesJobKind, HermesStatusOk } from "@/lib/types/hermes";
