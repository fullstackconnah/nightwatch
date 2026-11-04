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

/** ?wxsun=dusk's sun (kiosk-weather-fx.ts SUNS.dusk): just below the horizon, so the rain draws its dusk look; the sunroom dusk stop sits at +10. */
const DUSK_SUN = { elevationDeg: -2, hourAngleDeg: 95, phase: "dusk", progress01: 1 };

/** The rain states for the rain-zone shots: weatherFor(stop) with the wet fields set (presets as WX_PRESETS in kiosk-weather-fx.ts). */
export const RAIN_STATES = {
  "heavy-night": { stop: "night", code: "rain", label: "Heavy rain", mmHr: 12, wind: 35 },
  "storm-dusk": { stop: "dusk", sun: DUSK_SUN, code: "thunderstorm", label: "Thunderstorm", mmHr: 9, wind: 45 },
  "drizzle-dusk": { stop: "dusk", sun: DUSK_SUN, code: "drizzle", label: "Drizzle", mmHr: 0.3, wind: 8 },
};

export function rainWeatherFor(state) {
  const s = RAIN_STATES[state];
  const w = weatherFor(s.stop);
  return {
    ...w,
    ...(s.sun && { sun: s.sun }),
    // precipMm is a 15-minute total (kiosk-weather-fx.ts effectiveMmHr)
    current: { ...w.current, label: s.label, code: s.code, cloudCoverPct: 100, humidityPct: 90, precipMm: s.mmHr / 4, windKmh: s.wind },
    days: w.days.map((d) => ({ ...d, code: s.code, label: s.label, rainPct: 80 })),
    rain: { hours: [], summary: null, nowcast: [{ minutesFromNow: 0, precipMmHr: s.mmHr }] },
  };
}

/** /kiosk/api/nowplaying: the bottom-centre pill (NowPlayingActive, src/lib/types/nowplaying.ts). */
export const NOW_PLAYING = { status: "ok", source: "ha", title: "Evening news", appName: "YouTube", state: "playing", progress01: 0.4 };

/** Rain states only: the content of the shipped defect (a longer light tile, a long now-playing title), placeholder text. */
export const RAIN_NOW_PLAYING = { ...NOW_PLAYING, title: "The Long Evening Programme Hour" };
export const RAIN_HA_STATES = {
  ...HA_STATES,
  entities: { ...HA_STATES.entities, lights: [{ entityId: "light.floodlight", name: "Front door Floodlight", on: true, brightnessPct: 60, available: true }] },
};

/** Every other /kiosk/api/* route answers "not configured": the kiosk renders its quiet state for each. */
export const QUIET = { status: "unconfigured" };

/** The pinned instant for the main states: Sydney, 10:30, so the clock and any time text are stable. */
export const PINNED_ISO = "2026-06-15T10:30:00+10:00";
export const ZONE = "Australia/Sydney";

/** /kiosk/api/ha/states in the full HaStatesResponse shape (src/lib/types/ha.ts): a partial body throws in render.
 *  Two climates (heating, and unavailable) cover the working glow and the unavailable state; Lamp starts off so the chip step's press is a visible change (writes are mocked, so only the press shows, not a re-polled on); the lights, switches and
 *  scene cover Chip on, off and the sun catch. */
export const HA_STATES = {
  status: "ok",
  entities: {
    lights: [{ entityId: "light.lamp", name: "Lamp", on: false, brightnessPct: 60, available: true }],
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

/** /kiosk/api/vitals as HostVitals (src/lib/host-metrics.ts:19): kiosk-client.ts:129 and kiosk-status-strip.tsx:93 read cpu.percent and memory.percent. */
export const VITALS = {
  hostname: "host", os: "Linux", uptimeSeconds: 86400,
  cpu: { percent: 12, cores: 4, model: "cpu", loadAvg: [0.4, 0.3, 0.2] },
  memory: { total: 16e9, used: 6e9, available: 10e9, percent: 38 },
  disk: [{ mount: "/", total: 500e9, used: 200e9, percent: 40 }],
  network: { rxPerSec: 1000, txPerSec: 500 },
  tempC: 45, ts: 1781484600000,
};

/** /kiosk/api/health as KioskHealthCounts (kiosk-client.ts:132), the route's body at app/kiosk/api/health/route.ts:14. */
export const HEALTH = { total: 10, running: 9, paused: 0, restarting: 0, stopped: 1, unhealthy: 0, dead: 0 };

/** /kiosk/api/doorbell as the unconfigured HaDoorbellSnapshot (ha-doorbell.ts:329): kiosk-doorbell.tsx:257 reads data.cameras.length, so QUIET threw there. */
export const DOORBELL = { status: "unconfigured", cameras: [], triggers: [], latest: null, autoOpen: true, viewCamera: null };

/** Every /kiosk/api/* path the glance and standard layouts fetch, with its real-shaped body. Anything not listed (or weather and
 *  attention, which visit() answers itself) gets QUIET. */
export const ROUTES = {
  "/kiosk/api/vitals": VITALS,
  "/kiosk/api/health": HEALTH,
  "/kiosk/api/doorbell": DOORBELL,
  "/kiosk/api/nowplaying": { status: "idle" },
  "/kiosk/api/downloads": { status: "unconfigured" },
  "/kiosk/api/briefing": { status: "unconfigured" },
  "/kiosk/api/weather/radar": { status: "unconfigured" },
};
