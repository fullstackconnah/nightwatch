export type TelemetryStatus = "connecting" | "live" | "lost";

/** The stream stays open and pings while the server emits nothing (Docker down), so silence this long means the numbers are frozen. */
export const TELEMETRY_STALE_MS = 10_000;

/**
 * What the UI should show: a "live" stream whose last data arrived more than TELEMETRY_STALE_MS ago reads "lost".
 * `lastDataAt` is the CLIENT receive time (Date.now() here), never the server sample ts, so clock skew cannot fake staleness.
 */
export function effectiveTelemetryStatus(status: TelemetryStatus, lastDataAt: number | null, now: number): TelemetryStatus {
  if (status === "live" && lastDataAt !== null && now - lastDataAt > TELEMETRY_STALE_MS) return "lost";
  return status;
}
