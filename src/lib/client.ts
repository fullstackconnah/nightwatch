"use client";

import useSWR, { mutate as globalMutate } from "swr";
import type { TiledContainer } from "@/lib/tiles";
import type { HostVitals } from "@/lib/host-metrics";
import type { ContainerStatsSnapshot, ResourceSnapshot } from "@/lib/docker";
import type { DiskUsageScan } from "@/lib/disk-usage";
import type { WidgetData } from "@/lib/widgets/types";
import type { AppConfig } from "@/lib/config";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new ApiError("unauthorized", 401);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
  return body;
};

export interface ContainersResponse {
  containers: TiledContainer[];
  groups: string[];
  counts: { total: number; running: number; stopped: number; restarting: number; unhealthy: number };
}

export function useContainers(refreshMs = 5000) {
  return useSWR<ContainersResponse>("/api/docker/containers", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

export function useHost(refreshMs = 5000) {
  return useSWR<HostVitals>("/api/host", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

export function useWidgets(refreshMs = 20000) {
  return useSWR<{ widgets: Record<string, WidgetData> }>("/api/widgets", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

export function useResources(refreshMs = 10000) {
  return useSWR<ResourceSnapshot>("/api/resources", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

function diskUsageKey(label: string): string {
  return `/api/resources/disk-usage?disk=${encodeURIComponent(label)}`;
}

/** Only fetches once a disk is expanded — pass null to skip. */
export function useDiskUsage(label: string | null) {
  return useSWR<DiskUsageScan>(label ? diskUsageKey(label) : null, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 0,
    keepPreviousData: true,
  });
}

/** Forces a fresh (non-cached) scan and pushes the result into useDiskUsage's SWR cache. */
export async function refreshDiskUsage(label: string): Promise<DiskUsageScan> {
  const data = await fetcher(`${diskUsageKey(label)}&refresh=1`);
  await globalMutate(diskUsageKey(label), data, false);
  return data as DiskUsageScan;
}

export function useSettings() {
  return useSWR<{
    config: AppConfig;
    meta: {
      widgetTypes: string[];
      publicHost: string;
      dockgeUrl: string;
      authConfigured: boolean;
      dataDir: string;
    };
  }>("/api/settings", fetcher);
}

export type { TiledContainer, HostVitals, ContainerStatsSnapshot, WidgetData, AppConfig, ResourceSnapshot, DiskUsageScan };

export async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  return data;
}

export async function putJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  return data;
}
