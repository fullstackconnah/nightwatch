"use client";

import { useEffect, useRef, useState } from "react";
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

export interface KioskVitalsSample {
  ts: number;
  cpu: number;
  mem: number;
  rx: number;
  tx: number;
}

/** Samples kept in useKioskVitalsHistory's ring buffer. At the hook's 5s
 *  default poll interval, 48 * 5s = 240s = 4 minutes: long enough that a
 *  spike someone noticed walking past is still on screen by the time they
 *  reach the wall tablet to look at it, short enough that the buffer stays
 *  bounded on a kiosk screen that can stay open for days without a reload. */
const HISTORY_CAPACITY = 48;

/**
 * Wraps useKioskVitals in a client-side ring buffer, for kiosk-spark.tsx's
 * trend charts. /kiosk/api/vitals returns HostVitals — ONE instant per field,
 * no history — and there is no time-series store anywhere else in the kiosk
 * data path: useTelemetryStream's ring (src/lib/client.ts) is SSE-backed and
 * authenticated-dashboard-only, and /kiosk is deliberately unauthenticated,
 * so it cannot be wired to that instead. This buffers independently,
 * client-side, from whatever useKioskVitals already polls.
 *
 * Deliberately calls useKioskVitals rather than opening a second
 * useSWR("/kiosk/api/vitals") key — same route, same refreshMs, so sharing
 * the one call keeps this from doubling the poll rate against the host
 * metrics route.
 */
export function useKioskVitalsHistory(refreshMs = 5000): {
  data: HostVitals | undefined;
  error: unknown;
  isLoading: boolean;
  history: KioskVitalsSample[];
} {
  const { data, error, isLoading } = useKioskVitals(refreshMs);
  const [history, setHistory] = useState<KioskVitalsSample[]>([]);
  // The ts of the last sample actually appended — compared against
  // `data.ts`, not against the previous `data` reference, so a revalidation
  // that hands back the identical object (see below) is caught by value, not
  // by luck of reference equality.
  const lastTsRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // No data yet (first paint) — nothing to buffer.
    if (!data) return;
    // SWR's `keepPreviousData` hands back the SAME `data` object across a
    // failed revalidation (see useFreshness's doc comment above), and this
    // effect's dependency array can't tell that apart from a render caused
    // by something else re-rendering the tree — either way `data` here is
    // the exact reference from last time, same `ts` and all. Appending on
    // every one of those renders would fill the 48-slot buffer with copies
    // of one reading in seconds; comparing `ts` instead of trusting "the
    // effect ran" means a failed poll silently stops growing the buffer
    // without any extra failure-detection logic of its own.
    if (data.ts === lastTsRef.current) return;
    lastTsRef.current = data.ts;
    setHistory((prev) => {
      // Functional updater + immutable append: a ref alone would survive
      // re-renders but never trigger one, and the chart needs a re-render
      // every time the buffer actually grows.
      const next = [
        ...prev,
        {
          ts: data.ts,
          cpu: data.cpu.percent,
          mem: data.memory.percent,
          rx: data.network.rxPerSec,
          tx: data.network.txPerSec,
        },
      ];
      return next.length > HISTORY_CAPACITY ? next.slice(next.length - HISTORY_CAPACITY) : next;
    });
  }, [data]);

  return { data, error, isLoading, history };
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
