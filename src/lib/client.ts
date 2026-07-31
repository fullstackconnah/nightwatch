"use client";

import useSWR, { mutate as globalMutate } from "swr";
import useSWRSubscription from "swr/subscription";
import type { TiledContainer } from "@/lib/tiles";
import type { HostVitals } from "@/lib/host-metrics";
import type { ContainerStatsSnapshot, ResourceSnapshot } from "@/lib/docker";
import type { DiskUsageScan } from "@/lib/disk-usage";
import type { WidgetData } from "@/lib/widgets/types";
import type { AppConfig } from "@/lib/config";
import { RING_CAPACITY, type TelemetryRow, type TelemetrySample } from "@/lib/telemetry-types";
import type { TranscodeSnapshot } from "@/lib/transcode-types";
import type { ProcessSnapshot, ProcessRow } from "@/lib/process-types";
import type { SmartSnapshot, DriveHealth, AtaAttribute, ArrayIntegrity, HealthVerdict } from "@/lib/smart-types";
import type { NetworkSnapshot, NetInterface, ListeningSocket, SocketOwner, InterfaceRole } from "@/lib/network-types";

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
  counts: {
    total: number;
    running: number;
    paused: number;
    stopped: number;
    restarting: number;
    unhealthy: number;
  };
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

export function useTranscodes(refreshMs = 5000) {
  return useSWR<TranscodeSnapshot>("/api/transcodes", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

/** `enabled` matters here: the ALL tab is one of six, and polling ~476 /proc
 * entries every 2s when that tab isn't open is waste — the null SWR key is
 * how that's avoided (mirrors useDiskUsage's pattern). */
export function useProcesses(refreshMs = 2000, enabled = true) {
  return useSWR<ProcessSnapshot>(enabled ? "/api/processes" : null, fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

// 30s: the host collector only republishes smart.json every 5 minutes, so
// polling faster than that buys nothing for most fields — only the hwmon
// temperatures embedded in each drive move faster than the collector cadence.
export function useSmart(refreshMs = 30000) {
  return useSWR<SmartSnapshot>("/api/smart", fetcher, { refreshInterval: refreshMs, keepPreviousData: true });
}

// 15s: interface inventory/sockets change slowly (link flaps, new listeners) —
// per-interface *rates* ride the 1Hz telemetry SSE instead, same split as host vitals.
export function useNetwork(refreshMs = 15000) {
  return useSWR<NetworkSnapshot>("/api/network", fetcher, { refreshInterval: refreshMs, keepPreviousData: true });
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

export type TelemetryStatus = "connecting" | "live" | "lost";

export interface TelemetryState {
  samples: TelemetrySample[]; // rolling, oldest first, capped at RING_CAPACITY
  status: TelemetryStatus;
}

/**
 * Subscribes to the container telemetry SSE stream and accumulates a rolling
 * window of samples client-side (SWR's subscription cache only holds the latest
 * emitted value, so this hook owns the buffer rather than relying on SWR for it).
 * Pass `enabled = false` to skip subscribing entirely (null key).
 */
export function useTelemetryStream(enabled = true): TelemetryState {
  const { data } = useSWRSubscription<TelemetryState, Error>(
    enabled && typeof window !== "undefined" ? "/api/telemetry/stream" : null,
    (key: string, { next }: { next: (err?: Error | null, data?: TelemetryState) => void }) => {
      let samples: TelemetrySample[] = [];
      const es = new EventSource(key);

      const emit = (status: TelemetryStatus) => next(null, { samples, status });

      es.addEventListener("open", () => emit("live"));

      es.addEventListener("history", (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as TelemetrySample[];
          samples = parsed.slice(-RING_CAPACITY);
          emit("live");
        } catch (err) {
          next(err instanceof Error ? err : new Error("failed to parse telemetry history"));
        }
      });

      es.addEventListener("sample", (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as TelemetrySample;
          samples = [...samples, parsed].slice(-RING_CAPACITY);
          emit("live");
        } catch (err) {
          next(err instanceof Error ? err : new Error("failed to parse telemetry sample"));
        }
      });

      // Transient network errors: EventSource auto-reconnects on its own and will
      // fire "open" again, so just surface "lost" via status — don't close the
      // connection or reject via next(), and keep existing samples so the UI can
      // dim stale data instead of blanking.
      es.onerror = () => emit("lost");

      return () => es.close();
    },
  );

  return data ?? { samples: [], status: "connecting" };
}

export type TelemetryMetric = "cpu" | "mem" | "net" | "blkio";

function telemetryMetricValue(row: TelemetryRow, metric: TelemetryMetric): number {
  switch (metric) {
    case "cpu":
      return row.cpuPct;
    case "mem":
      return row.memBytes;
    case "net":
      return row.rxRate + row.txRate;
    case "blkio":
      return row.blkReadRate + row.blkWriteRate;
  }
}

/**
 * Maps each sample to one container's value for `metric`, keeping the series
 * length equal to `samples.length` (missing/not-yet-running containers contribute
 * 0) so a sparkline's x-axis stays time-aligned across containers.
 */
export function seriesFor(samples: TelemetrySample[], containerId: string, metric: TelemetryMetric): number[] {
  return samples.map((sample) => {
    const row = sample.containers[containerId];
    if (!row) return 0;
    const value = telemetryMetricValue(row, metric);
    return Number.isFinite(value) ? value : 0;
  });
}

export type {
  TiledContainer,
  HostVitals,
  ContainerStatsSnapshot,
  WidgetData,
  AppConfig,
  ResourceSnapshot,
  DiskUsageScan,
  TelemetrySample,
  TelemetryRow,
  TranscodeSnapshot,
  ProcessSnapshot,
  ProcessRow,
  SmartSnapshot,
  DriveHealth,
  AtaAttribute,
  ArrayIntegrity,
  HealthVerdict,
  NetworkSnapshot,
  NetInterface,
  ListeningSocket,
  SocketOwner,
  InterfaceRole,
};

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
