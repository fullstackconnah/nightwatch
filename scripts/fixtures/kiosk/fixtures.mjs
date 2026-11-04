/* Fixtures for scripts/kiosk-shots.mjs: every /kiosk/api/* answer is mocked so a run never depends on the test
 * stack's Home Assistant, weather feed or host telemetry, and the sun lands exactly where the shape brief
 * (sunroom-ds.md section 8) pins it. */

/** The six stops, as a mocked sun that makes `sunroomT` land on the stop exactly (no azimuthDeg: the geo blend is skipped). */
export const STOP_SUNS = {
  night: { elevationDeg: -25, hourAngleDeg: 180 },
  dawn: { elevationDeg: 10, hourAngleDeg: -109.47 },
  morning: { elevationDeg: 10, hourAngleDeg: -70.53 },
  midday: { elevationDeg: 35, hourAngleDeg: 0 },
  golden: { elevationDeg: 10, hourAngleDeg: 70.53 },
  dusk: { elevationDeg: 10, hourAngleDeg: 109.47 },
};

export const STOPS = Object.keys(STOP_SUNS);

/** The /kiosk/api/weather body for one stop. progress01 only matters when hourAngleDeg is missing. */
export function weatherFor(stop) {
  const s = STOP_SUNS[stop];
  return {
    status: "ok",
    // the real /kiosk/api/weather current shape (kiosk-weather-fx.test.ts:328), or kiosk-surface's label.toLowerCase() throws
    current: { tempC: 14, feelsC: 13, humidityPct: 60, label: "Clear", cloudCoverPct: 0, precipMm: 0, windKmh: 5, code: "clear" },
    rain: { nowcast: [{ minutesFromNow: 0, precipMmHr: 0 }] },
    sun: { elevationDeg: s.elevationDeg, hourAngleDeg: s.hourAngleDeg, phase: s.elevationDeg > 6 ? "day" : s.elevationDeg > -6 ? "dawn" : "night", progress01: 0.5 },
  };
}

/** Every other /kiosk/api/* route answers "not configured": the kiosk renders its quiet state for each. */
export const QUIET = { status: "unconfigured" };

/** The pinned instant for the main states: Sydney, 10:30, so the clock and any time text are stable. */
export const PINNED_ISO = "2026-06-15T10:30:00+10:00";
export const ZONE = "Australia/Sydney";
