import type { GpuUnavailableReason } from "./types/gpu.ts";

/** Most remote-peer rows /api/network sends; the rest are counted in `truncated`. */
export const CONNECTIONS_MAX = 200;

/** `sorted` must already be ordered busiest-first. */
export function capConnections<T>(sorted: T[]): { connections: T[]; truncated: number } {
  return { connections: sorted.slice(0, CONNECTIONS_MAX), truncated: Math.max(0, sorted.length - CONNECTIONS_MAX) };
}

/** A timeout or other transient failure ("error") must retry next tick, not sit out the 60 s backoff. */
export function isCacheableGpuReason(reason: GpuUnavailableReason): boolean {
  return reason !== "error";
}
