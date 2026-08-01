"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/client";
import type { HostVitals } from "@/lib/client";

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

export interface KioskElevationStatus {
  elevated: boolean;
  expiresAt?: number;
}

/**
 * Checks (and, if a valid elevation cookie is present, slides) the kiosk PIN
 * elevation. Called once on mount to recover an elevation that survived a
 * reload, and again on interaction while elevated to keep the window alive —
 * see /api/auth/kiosk/refresh/route.ts for why one endpoint does both jobs.
 */
export async function refreshKioskElevation(): Promise<KioskElevationStatus> {
  try {
    const res = await fetch("/api/auth/kiosk/refresh", { method: "POST" });
    const data = await res.json().catch(() => ({ elevated: false }));
    return data as KioskElevationStatus;
  } catch {
    return { elevated: false };
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
