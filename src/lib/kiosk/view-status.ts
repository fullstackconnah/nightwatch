/** Status decisions for two kiosk views, pulled out so node:test can load them. */

export type WeatherViewStatus = "loading" | "unconfigured" | "unreachable-empty" | "ready" | "ready-stale";

export function weatherViewStatus(i: {
  hasData: boolean;
  payload?: "ok" | "unconfigured" | "unreachable";
  hasError: boolean;
  isLoading: boolean;
  hasLastOk: boolean;
}): WeatherViewStatus {
  if (!i.hasData) {
    if (i.isLoading) return "loading";
    return i.hasLastOk ? "ready-stale" : "unreachable-empty";
  }
  if (i.payload === "unconfigured") return "unconfigured";
  if (i.payload === "unreachable") return i.hasLastOk ? "ready-stale" : "unreachable-empty";
  // keepPreviousData keeps the old payload through a failed revalidation, so an error beside data means it is stale.
  return i.hasError ? "ready-stale" : "ready";
}

export type CameraStatus = "connecting" | "live" | "stills" | "failed";

/** A failed probe wins even after a good frame; the frame itself stays on screen. */
export function cameraStatus(mode: "stream" | "snapshot", painted: boolean, failed: boolean): CameraStatus {
  if (failed) return "failed";
  if (!painted) return "connecting";
  return mode === "stream" ? "live" : "stills";
}
