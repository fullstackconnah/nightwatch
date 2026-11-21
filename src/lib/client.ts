"use client";

import useSWR, { mutate as globalMutate } from "swr";
import useSWRSubscription from "swr/subscription";
import type { TiledContainer } from "@/lib/tiles";
import type { HostVitals } from "@/lib/host-metrics";
import type { ContainerStatsSnapshot, ResourceSnapshot } from "@/lib/docker";
import type { DiskUsageScan } from "@/lib/disk-usage";
import type { WidgetData } from "@/lib/widgets/types";
import type { AppConfig } from "@/lib/config";
import { RING_CAPACITY, type TelemetryRow, type TelemetrySample } from "@/lib/types/telemetry";
import type { TranscodeSnapshot } from "@/lib/types/transcode";
import type { ProcessSnapshot, ProcessRow } from "@/lib/types/process";
import type { SmartSnapshot, DriveHealth, AtaAttribute, ArrayIntegrity, HealthVerdict } from "@/lib/types/smart";
import type { BackupResponse } from "@/lib/backup-status";
import type { AttentionReport } from "@/lib/attention-report";
import type { NetworkSnapshot, NetInterface, ListeningSocket, SocketOwner, InterfaceRole } from "@/lib/types/network";
import type { McInstance, McBackup } from "@/lib/minecraft/manager";
import type { PackResult } from "@/lib/minecraft/packs";

import { ApiError } from "@/lib/api-error";
import { shouldRedirectToLogin } from "@/lib/login-redirect";
import { afterClosedProbe } from "@/lib/log-reconnect";
import { effectiveTelemetryStatus, type TelemetryStatus } from "@/lib/telemetry-status";
export { ApiError, serverMessage } from "@/lib/api-error";

/** The one 401 rule: a signed-out tab goes to /login (never the kiosk). True on a browser 401; the caller keeps its own handling. */
export function redirectOn401(res: Response): boolean {
  if (res.status !== 401 || typeof window === "undefined") return false;
  if (shouldRedirectToLogin(window.location.pathname)) window.location.href = "/login";
  return true;
}

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (redirectOn401(res)) throw new ApiError("unauthorized", 401);
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

// 60s: the status file is rewritten once a day; this only needs to notice that day's write.
export function useBackupStatus(refreshMs = 60000) {
  return useSWR<BackupResponse>("/api/backup", fetcher, { refreshInterval: refreshMs, keepPreviousData: true });
}

// 15s: Home's attention report. The key stays null until `since` (the stored last-looked time) resolves, so
// the first request already carries it; keepPreviousData holds the last report through a failed poll.
export function useAttentionReport(since: number | null, refreshMs = 15000) {
  return useSWR<AttentionReport>(since === null ? null : `/api/attention?since=${since}`, fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

// 15s: interface inventory/sockets change slowly (link flaps, new listeners) —
// per-interface *rates* ride the 1Hz telemetry SSE instead, same split as host vitals.
export function useNetwork(refreshMs = 15000) {
  return useSWR<NetworkSnapshot>("/api/network", fetcher, { refreshInterval: refreshMs, keepPreviousData: true });
}

export interface MinecraftStatusResponse {
  manager: "ok" | "unconfigured" | "unreachable" | "unauthorized";
  managerDetail?: string;
  instances: McInstance[];
  active: string | null;
  players: { online: number; max: number; players: string[] } | null;
  rcon: "ok" | "unavailable" | "rejected" | "unconfigured";
}

export function useMinecraftStatus(refreshMs = 10000) {
  return useSWR<MinecraftStatusResponse>("/api/minecraft/status", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

export function useMinecraftBackups(refreshMs = 30000) {
  return useSWR<{ backups: McBackup[] }>("/api/minecraft/backups", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

export interface PackSearchResponse {
  results: PackResult[];
  curseforge: "ok" | "no-key" | "error";
  modrinth: "ok" | "error";
}

export function useMinecraftPackSearch(q: string, source: "all" | "curseforge" | "modrinth") {
  return useSWR<PackSearchResponse>(
    q ? `/api/minecraft/packs/search?q=${encodeURIComponent(q)}&source=${source}` : null,
    fetcher,
    {
      keepPreviousData: true,
    },
  );
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

export type { TelemetryStatus };

export interface TelemetryState {
  samples: TelemetrySample[]; // rolling, oldest first, capped at RING_CAPACITY
  status: TelemetryStatus;
}

/**
 * Subscribes to the container telemetry SSE stream and accumulates a rolling
 * window of samples client-side (SWR's subscription cache only holds the latest
 * emitted value, so this hook owns the buffer rather than relying on SWR for it).
 * Pass `enabled = false` to skip subscribing entirely (null key).
 *
 * Background-tab handling: the stream itself is never paused — bandwidth is
 * trivial and reconnecting would risk a gap — but `next()` (the call that
 * triggers a React re-render in every subscribing tab, e.g. /resources'
 * per-second container re-sort and the treemap re-layout) is skipped while
 * `document.visibilityState !== "visible"`. Samples still accumulate in the
 * closure so nothing is lost; on return to the foreground a single flush
 * replays the latest accumulated state, not one render per buffered tick.
 */
export function useTelemetryStream(enabled = true): TelemetryState {
  const { data } = useSWRSubscription<TelemetryState, Error>(
    enabled && typeof window !== "undefined" ? "/api/telemetry/stream" : null,
    (key: string, { next }: { next: (err?: Error | null, data?: TelemetryState) => void }) => {
      let samples: TelemetrySample[] = [];
      let status: TelemetryStatus = "connecting";
      // Set whenever the buffer above changes while hidden — tells the
      // visibilitychange handler there's a render to catch up on.
      let dirty = false;

      // Client receive time of the newest open/history/sample; a silent-but-open stream turns "live" into "lost".
      let lastDataAt: number | null = null;
      let shown: TelemetryStatus = status;

      const emit = () => {
        shown = effectiveTelemetryStatus(status, lastDataAt, Date.now());
        if (document.visibilityState === "hidden") {
          dirty = true;
          return;
        }
        dirty = false;
        next(null, { samples, status: shown });
      };
      const staleTimer = setInterval(() => {
        if (effectiveTelemetryStatus(status, lastDataAt, Date.now()) !== shown) emit();
      }, 2000);

      let es: EventSource;
      let attempt = 0;
      let cancelled = false;
      let reopenTimer: ReturnType<typeof setTimeout> | null = null;

      const connect = () => {
        es = new EventSource(key);
        const current = es;

        current.addEventListener("open", () => {
          attempt = 0;
          status = "live";
          lastDataAt = Date.now();
          emit();
        });

        current.addEventListener("history", (event: MessageEvent<string>) => {
          try {
            const parsed = JSON.parse(event.data) as TelemetrySample[];
            samples = parsed.slice(-RING_CAPACITY);
            status = "live";
            lastDataAt = Date.now();
            emit();
          } catch (err) {
            next(err instanceof Error ? err : new Error("failed to parse telemetry history"));
          }
        });

        current.addEventListener("sample", (event: MessageEvent<string>) => {
          try {
            const parsed = JSON.parse(event.data) as TelemetrySample;
            samples = [...samples, parsed].slice(-RING_CAPACITY);
            status = "live";
            lastDataAt = Date.now();
            emit();
          } catch (err) {
            next(err instanceof Error ? err : new Error("failed to parse telemetry sample"));
          }
        });

        // A dropped connection: EventSource retries by itself and fires "open" again, so just
        // surface "lost" and keep the samples so the UI dims stale data. A non-200 reply (401 after
        // the session expires, a proxy 502 during a deploy) CLOSES the stream for good: the
        // browser never retries, so probe the session and either sign out or reopen with backoff.
        current.onerror = () => {
          status = "lost";
          emit();
          if (current.readyState !== EventSource.CLOSED) return;
          void (async () => {
            let probeStatus: number | null = null;
            try {
              probeStatus = (await fetch("/api/host", { credentials: "same-origin" })).status;
            } catch {
              // Probe failed (offline): reopen and let the next error probe again.
            }
            if (cancelled) return;
            const action = afterClosedProbe(probeStatus, attempt);
            if (action.kind === "signed-out") {
              window.location.href = "/login";
              return;
            }
            attempt += 1;
            reopenTimer = setTimeout(() => {
              reopenTimer = null;
              if (!cancelled) connect();
            }, action.delayMs);
          })();
        };
      };
      connect();

      // The one moment a hidden tab is allowed to render: coming back into view.
      // Flushes whatever accumulated while backgrounded in a single next() call.
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible" && dirty) {
          dirty = false;
          next(null, { samples, status: shown });
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);

      return () => {
        cancelled = true;
        clearInterval(staleTimer);
        if (reopenTimer !== null) clearTimeout(reopenTimer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        es.close();
      };
    },
  );

  return data ?? { samples: [], status: "connecting" };
}

export { seriesFor, type TelemetryMetric } from "@/lib/chart-points";

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

/** `own401`: the caller shows the server's 401 message itself (a wrong current password), so the tab stays put. */
export async function postJson(url: string, body?: unknown, opts?: { own401?: boolean }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!opts?.own401) redirectOn401(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status, typeof data.stepUp === "string" ? data.stepUp : undefined);
  return data;
}

export async function putJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  redirectOn401(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  return data;
}
