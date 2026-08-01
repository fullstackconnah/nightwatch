"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/client";
import type { ProxyManagerSnapshot } from "@/lib/npm-types";

/**
 * Feature-local hook for the /proxy route map, kept out of src/lib/client.ts the
 * same way useLogStream is — one file per surface rather than growing the shared
 * hook barrel. Reuses client.ts's `fetcher` (same 401-redirects-to-/login contract)
 * rather than reimplementing it.
 *
 * 30s: NPM route/cert config changes rarely and the server already caches its own
 * upstream health probes for 15s, so polling faster than that buys nothing.
 */
export function useProxyManager(refreshMs = 30000) {
  return useSWR<ProxyManagerSnapshot>("/api/proxy-manager", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

export type { ProxyManagerSnapshot };
export type { ProxyRoute, ProxyCertificate, RouteHealth, ProxyManagerStatus } from "@/lib/npm-types";
