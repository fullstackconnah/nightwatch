"use client";

import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/client";
import { resetLastOk, trackLastOk } from "@/lib/orchestra-view";
import type { OrchestraDetailResponse, OrchestraSnapshot } from "@/lib/types/orchestra";

// shortcut: last-known is held in module memory (orchestra-view), so it survives client-side navigation but not a
// reload; upgrade to sessionStorage if the owner opens the page cold while the PC sleeps and misses the last-known cards.
const STATUS_KEY = "/api/orchestra/status";

/** Drops the last-known cards and the cached poll, so a changed service never shows the old one's orchestrators. */
export function resetOrchestraStatus() {
  resetLastOk();
  void mutate(STATUS_KEY, undefined, { revalidate: false });
}

/** Polls every 10 s. SWR's default refreshWhenHidden=false pauses it in a hidden tab; deliberately not overridden. */
export function useOrchestraStatus() {
  const r = useSWR<OrchestraSnapshot>(STATUS_KEY, fetcher, { refreshInterval: 10000, keepPreviousData: true });
  return { data: r.data, lastOk: trackLastOk(r.data), error: r.error as unknown, isLoading: r.isLoading };
}

/** The service runs its watcher command per detail call, so fetch only while a card is open. */
export function useOrchestraDetail(name: string, open: boolean) {
  return useSWR<OrchestraDetailResponse>(
    open ? `/api/orchestra/orchestrators/${encodeURIComponent(name)}` : null,
    fetcher,
    { refreshInterval: 10000, keepPreviousData: true },
  );
}
