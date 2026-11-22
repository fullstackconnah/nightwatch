/** Status decisions for two kiosk views, pulled out so node:test can load them. */

export type WeatherViewStatus = "loading" | "unconfigured" | "unreachable-empty" | "ready" | "ready-stale";

/** A kept forecast older than this is no longer shown as current. */
export const WEATHER_MAX_STALE_MS = 3 * 60 * 60 * 1000;

export function weatherViewStatus(i: {
  hasData: boolean;
  payload?: "ok" | "unconfigured" | "unreachable";
  hasError: boolean;
  isLoading: boolean;
  hasLastOk: boolean;
  /** Age of the last good answer; undefined means unknown and keeps the stale tag at any age. */
  lastOkAgeMs?: number;
}): WeatherViewStatus {
  const stale: WeatherViewStatus =
    i.lastOkAgeMs !== undefined && i.lastOkAgeMs > WEATHER_MAX_STALE_MS ? "unreachable-empty" : "ready-stale";
  if (!i.hasData) {
    if (i.isLoading) return "loading";
    return i.hasLastOk ? stale : "unreachable-empty";
  }
  if (i.payload === "unconfigured") return "unconfigured";
  if (i.payload === "unreachable") return i.hasLastOk ? stale : "unreachable-empty";
  // keepPreviousData keeps the old payload through a failed revalidation, so an error beside data means it is stale.
  return i.hasError ? stale : "ready";
}

export type CameraStatus = "connecting" | "live" | "stills" | "failed";

/** A failed probe wins even after a good frame; the frame itself stays on screen. */
export function cameraStatus(mode: "stream" | "snapshot", painted: boolean, failed: boolean): CameraStatus {
  if (failed) return "failed";
  if (!painted) return "connecting";
  return mode === "stream" ? "live" : "stills";
}
