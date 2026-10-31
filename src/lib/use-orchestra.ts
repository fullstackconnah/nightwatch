"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/client";
import type { OrchestraDetailResponse, OrchestraSnapshot } from "@/lib/types/orchestra";

// shortcut: held in module memory, so it survives client-side navigation but not a reload; upgrade to
// sessionStorage if the owner opens the page cold while the PC sleeps and misses the last-known cards.
let lastOk: OrchestraSnapshot | null = null;

/** Polls every 10 s. SWR's default refreshWhenHidden=false pauses it in a hidden tab; deliberately not overridden. */
export function useOrchestraStatus() {
  const r = useSWR<OrchestraSnapshot>("/api/orchestra/status", fetcher, { refreshInterval: 10000, keepPreviousData: true });
  if (r.data?.status === "ok") lastOk = r.data;
  return { data: r.data, lastOk, error: r.error as unknown, isLoading: r.isLoading };
}

/** The service runs its watcher command per detail call, so fetch only while a card is open. */
export function useOrchestraDetail(name: string, open: boolean) {
  return useSWR<OrchestraDetailResponse>(
    open ? `/api/orchestra/orchestrators/${encodeURIComponent(name)}` : null,
    fetcher,
    { refreshInterval: 10000, keepPreviousData: true },
  );
}
