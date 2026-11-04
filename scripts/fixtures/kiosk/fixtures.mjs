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
    // the full WeatherOk shape the header, rail and radar read (kiosk-weather-fx.test.ts:326-330); a partial body throws in render
    place: "Home",
    current: { tempC: 14, feelsC: 13, humidityPct: 60, label: "Clear", cloudCoverPct: 0, precipMm: 0, windKmh: 5, code: "clear" },
    days: ["15", "16", "17", "18", "19"].map((d) => ({ date: `2026-06-${d}`, code: "clear", label: "Clear", maxC: 17, minC: 9, rainPct: 5, sunrise: `2026-06-${d}T07:00`, sunset: `2026-06-${d}T17:00` })),
    rain: { hours: [], summary: null, nowcast: [{ minutesFromNow: 0, precipMmHr: 0 }] },
    sun: { elevationDeg: s.elevationDeg, hourAngleDeg: s.hourAngleDeg, phase: s.elevationDeg > 6 ? "day" : s.elevationDeg > -6 ? "dawn" : "night", progress01: 0.5 },
  };
}

/** Every other /kiosk/api/* route answers "not configured": the kiosk renders its quiet state for each. */
export const QUIET = { status: "unconfigured" };

/** The pinned instant for the main states: Sydney, 10:30, so the clock and any time text are stable. */
export const PINNED_ISO = "2026-06-15T10:30:00+10:00";
export const ZONE = "Australia/Sydney";

/** /kiosk/api/ha/states in the full HaStatesResponse shape (src/lib/types/ha.ts): a partial body throws in render.
 *  Two climates (heating, and unavailable) cover the working glow and the unavailable state; the lights, switches and
 *  scene cover Chip on, off and the sun catch. */
export const HA_STATES = {
  status: "ok",
  entities: {
    lights: [{ entityId: "light.lamp", name: "Lamp", on: true, brightnessPct: 60, available: true }],
    switches: [
      { entityId: "switch.fan", name: "Fan", on: false, available: true },
      { entityId: "switch.heater", name: "Heater", on: true, available: true },
    ],
    climates: [
      {
        entityId: "climate.living", name: "Living", hvacMode: "heat", hvacModes: ["off", "heat", "cool", "auto", "fan_only"],
        currentTemp: 19.5, targetTemp: 22, targetTempLow: null, targetTempHigh: null, unit: "°C", available: true,
        fanMode: "auto", fanModes: ["auto", "low", "medium", "high"], minTemp: 16, maxTemp: 30, targetTempStep: 0.5,
      },
      {
        entityId: "climate.study", name: "Study", hvacMode: "off", hvacModes: ["off", "heat", "cool"],
        currentTemp: null, targetTemp: null, targetTempLow: null, targetTempHigh: null, unit: "°C", available: false,
      },
    ],
    locks: [],
    sensors: [],
    scenes: [{ entityId: "scene.evening", name: "Evening", available: true }],
    mediaPlayers: [],
  },
};

/** /kiosk/api/climate-auto-off in the ClimateAutoOffServerState shape (use-climate-auto-off.ts): the pill and its sheet need it. */
export const AUTO_OFF = { enabled: true, time: "23:00", skipDate: null, lastRunDate: null };
