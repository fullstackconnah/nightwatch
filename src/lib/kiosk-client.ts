"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/client";
import type { HostVitals } from "@/lib/client";

export type FreshnessStatus = "loading" | "unreachable-empty" | "ready" | "ready-stale";

export interface Freshness<T> {
  status: FreshnessStatus;
  data: T | null;
}

/** Wraps a `useSWR({ keepPreviousData: true })` result so a revalidation that
 *  fails after a prior success reads as "old data, marked" instead of
 *  silently painting minutes-old numbers as current — the bug this exists to
 *  close: `error` and stale `data` can both be truthy at once, and a caller
 *  that only checks `data` can't tell the difference from a fresh read.
 *
 *  No extra `lastOk` tracking is needed here: SWR already keeps the last
 *  successful `data` across a failed revalidation on an unchanged key (that
 *  behavior predates and doesn't depend on `keepPreviousData`), so `data` IS
 *  the last known good. Contrast `useWeatherView` (kiosk-display.tsx), whose
 *  "stale" comes from the *payload* reporting a different status on an
 *  otherwise-successful 200 — a shape SWR has no way to distinguish from a
 *  fresh read, so that hook tracks `lastOk` itself. */
export function useFreshness<T>({
  data,
  error,
  isLoading,
}: {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
}): Freshness<T> {
  if (data === undefined) {
    return isLoading ? { status: "loading", data: null } : { status: "unreachable-empty", data: null };
  }
  return { status: error ? "ready-stale" : "ready", data };
}

export interface KioskHealthCounts {
  total: number;
  running: number;
  paused: number;
  restarting: number;
  stopped: number;
  unhealthy: number;
  dead: number;
}

/** Ambient host vitals — hits the public /kiosk/api/vitals route, not the
 *  authenticated /api/host one (see that route's own comment). */
export function useKioskVitals(refreshMs = 5000) {
  return useSWR<HostVitals>("/kiosk/api/vitals", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

/** Ambient container health counts — hits the public /kiosk/api/health route. */
export function useKioskHealth(refreshMs = 5000) {
  return useSWR<KioskHealthCounts>("/kiosk/api/health", fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });
}

// Discriminated so a wifi blip or a restarting container can't be confused
// with the server actually saying "no": callers must check `reachable`
// before trusting `elevated`. See page.tsx's slideExpiry for why that
// distinction matters — collapsing both into `elevated: false` used to kick
// an elevated kiosk back to the PIN pad on a single dropped request.
export type KioskElevationStatus =
  | { reachable: true; elevated: boolean; expiresAt?: number }
  | { reachable: false };

/**
 * Checks (and, if a valid elevation cookie is present, slides) the kiosk PIN
 * elevation. Called once on mount to recover an elevation that survived a
 * reload, and again on interaction while elevated to keep the window alive —
 * see /api/auth/kiosk/refresh/route.ts for why one endpoint does both jobs.
 */
export async function refreshKioskElevation(): Promise<KioskElevationStatus> {
  try {
    const res = await fetch("/api/auth/kiosk/refresh", { method: "POST" });
    // A non-OK status (e.g. a 502 while the container restarts) means we
    // couldn't ask the server, not that it denied us — same treatment as a
    // network-level failure below.
    if (!res.ok) return { reachable: false };
    const data = await res.json().catch(() => null);
    if (!data || typeof data.elevated !== "boolean") return { reachable: false };
    return { reachable: true, elevated: data.elevated, expiresAt: data.expiresAt };
  } catch {
    return { reachable: false };
  }
}

export interface KioskPinResult {
  ok: boolean;
  error?: string;
  lockedUntil?: number;
  expiresAt?: number;
}

export async function submitKioskPin(pin: string): Promise<KioskPinResult> {
  try {
    const res = await fetch("/api/auth/kiosk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || "PIN check failed", lockedUntil: data.lockedUntil };
    }
    return { ok: true, expiresAt: data.expiresAt };
  } catch {
    return { ok: false, error: "Couldn't reach the server" };
  }
}

export async function lockKiosk(): Promise<void> {
  await fetch("/api/auth/kiosk/lock", { method: "POST" }).catch(() => {});
}
