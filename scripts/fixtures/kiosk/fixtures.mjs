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
  // Day rings (slate ripples): WMO 80 maps to code showers, floor band light (about 18 rings alive). `day` crops the floor padded.
  "light-day": { stop: "midday", code: "showers", label: "Light showers", mmHr: 1.5, wind: 12, day: true },
  "drizzle-day": { stop: "midday", code: "drizzle", label: "Drizzle", mmHr: 0.3, wind: 8, day: true },
  "light-day-reduced": { stop: "midday", code: "showers", label: "Light showers", mmHr: 1.5, wind: 12, day: true, reduced: true },
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

/** Rain states only: the content of the shipped defect (a longer light tile, a long now-playing title), placeholder text. */
export const RAIN_NOW_PLAYING = { ...NOW_PLAYING, title: "The Long Evening Programme Hour" };
export const RAIN_HA_STATES = {
  ...HA_STATES,
  entities: { ...HA_STATES.entities, lights: [{ entityId: "light.floodlight", name: "Front door Floodlight", on: true, brightnessPct: 60, available: true }] },
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
export const DOORBELL = { status: "unconfigured", cameras: [], triggers: [], latest: null, autoOpen: true, viewCamera: null, lastSeenAt: null };

/** /kiosk/api/list for the shared shopping list. Invented names only. `n` open items and `t` ticked ones, in the server's order
 *  (open newest first, then ticked newest first). The shots fake answers writes itself; each state carries the answer it needs. */
const LIST_NAMES = ["Oat milk", "Bread", "Apples", "Eggs", "Tea", "Rice", "Jam", "Salt", "Soap", "Figs", "Pears", "Basil", "Honey"];
const listId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const LIST_SUGGEST = ["Bananas", "Butter", "Coffee", "Pasta"];
export function listBody(n, t = 0, suggestions = LIST_SUGGEST) {
  const mk = (i, extra = {}) => ({ id: listId(i + 1), listId: "shopping", text: LIST_NAMES[i], done: false, createdAt: 1000 + i, doneAt: null, updatedAt: 1000 + i, ...extra });
  const open = Array.from({ length: n }, (_, i) => mk(i)).reverse();
  const ticked = Array.from({ length: t }, (_, i) => mk(n + i, { done: true, doneAt: 5000 + i })).reverse();
  return { listId: "shopping", items: [...open, ...ticked], suggestions, serverTime: 10_000 };
}
export const LIST_EMPTY = listBody(0);
/** Two invented names at the 60-character maximum, on the two newest open rows (the sheet's and the pane's first slots). */
export const LONG_NAMES = ["Organic wholegrain sourdough bread from the corner bakery x2", "Family size pack of unscented dishwasher tablets with aid x4"];
export function longNamesBody(n) {
  const b = listBody(n);
  return { ...b, items: b.items.map((it, i) => (i < 2 ? { ...it, text: LONG_NAMES[i] } : it)) };
}
/** One entry per capture state: the body, plus `want` (text the state must show) and `not`. Counts for the no-scroll check use listBody directly. */
export const LIST_STATES = {
  ordinary: { body: listBody(3), want: ["Shopping · 3 to get", "Apples", "Bread", "Oat milk"] },
  crowded: { body: listBody(9), want: ["Shopping · 9 to get", "and 6 more"] },
  ticked: { body: listBody(3, 2), want: ["Ticked", "Clears at 4 am", "Clear 2 ticked"] },
  full: { body: listBody(11, 2), want: ["List is full. Clear ticked items or clear the list to add more.", "Clear 2 ticked"] },
  emptyChips: { body: listBody(0), want: ["Nothing on the list.", "Type above, or tap something you often buy.", "Often added"] },
  emptyNoChips: { body: listBody(0, 0, []), want: ["Nothing on the list.", "Type above to add the first item."], not: ["Often added"] },
};

/** Every /kiosk/api/* path the glance and standard layouts fetch, with its real-shaped body. Anything not listed (or weather and
 *  attention, which visit() answers itself) gets QUIET. */
export const ROUTES = {
  "/kiosk/api/vitals": VITALS,
  "/kiosk/api/health": HEALTH,
  "/kiosk/api/doorbell": DOORBELL,
  "/kiosk/api/nowplaying": { status: "idle" },
  "/kiosk/api/downloads": { status: "unconfigured" },
  "/kiosk/api/briefing": { status: "unconfigured" },
  "/kiosk/api/bins": { status: "unconfigured" }, // bin night (evening only); the bins section answers its own states
  "/kiosk/api/weather/radar": { status: "unconfigured" },
  "/kiosk/api/list": LIST_EMPTY, // every other capture sees an empty list: the pane drops and the button reads "Shopping 0"
};

/** UV and air states for the sun-air shots (kiosk-uv). Invented values. `at` pins the clock (Sydney, June, +10:00); `want` is
 *  the text the state must show (the shots fail the state when it is absent) and `not` text it must not. Sunset is 19:42 on every day (wx=off);
 *  under ?wx=overcast the client sees the preview's 18:40 instead. Crowded (18:30) is before either and uv-past (19:50) after both. `base` is the same moment with no UV or air
 *  (the Standard weather-line growth is measured against it). */
const uvOf = (day, peak, peakAt = "12:30 pm") => ({ day, peak, peakAt });
export const SUN_AIR_STATES = {
  ordinary: { at: "11:00", uv: uvOf("today", 6), air: { index: 31 }, want: ["Hats and sunscreen", "peak 12:30 pm", "Fair", "Index 31"] },
  morning: { at: "07:30", uv: uvOf("today", 6), air: { index: 31 }, want: ["Hats and sunscreen"] },
  crowded: { at: "18:30", uv: uvOf("today", 12), air: { index: 31 }, want: ["peaked 12:30 pm", "Extreme", "Hats and sunscreen"] },
  "crowded-am": { at: "07:30", uv: uvOf("today", 12), air: { index: 31 }, want: ["Extreme", "Hats and sunscreen"] },
  "uv-past": { at: "19:50", uv: uvOf("today", 12), air: { index: 31 }, want: ["Peaked 12:30 pm", "Extreme"], not: ["Hats and sunscreen"] },
  tomorrow: { at: "21:00", uv: uvOf("tomorrow", 12), air: { index: 31 }, want: ["Pack hats and sunscreen", "Extreme tomorrow", "peak 12:30 pm"] },
  worst: { at: "21:00", uv: uvOf("tomorrow", 10), air: { index: 140 }, want: ["Very high tomorrow", "Extremely poor", "Index 140"] },
  "air-poor-uv-low": { at: "11:00", uv: uvOf("today", 2), air: { index: 74 }, want: ["No hats needed", "Poor", "Index 74"] },
  "uv-missing-air-moderate": { at: "11:00", uv: null, air: { index: 52 }, want: ["Moderate", "Index 52"], not: ["UV"] },
  "air-missing-uv-9": { at: "11:00", uv: uvOf("today", 9, "1:00 pm"), air: null, want: ["Very high", "peak 1:00 pm"], not: ["Air quality"] },
  stale: { at: "11:00", uv: uvOf("today", 6), air: { index: 31 }, want: ["Hats and sunscreen"] },
  quiet: { at: "11:00", uv: uvOf("today", 2), air: { index: 12 }, want: [], quiet: true },
};

/** /kiosk/api/weather for one sun-air state (`base: true` drops uv and air). */
export function sunAirWeatherFor(state, { base = false } = {}) {
  const s = SUN_AIR_STATES[state];
  const w = weatherFor("midday");
  return { ...w, days: w.days.map((d) => ({ ...d, sunrise: `${d.date}T07:00`, sunset: `${d.date}T19:42` })), ...(base ? {} : { uv: s.uv, air: s.air }) };
}

/** The pinned instant for a sun-air state. */
export const sunAirInstant = (state) => `2026-06-15T${SUN_AIR_STATES[state].at}:00+10:00`;

/** What the Standard weather line must contain for a state (`not`: must not). Day and evening read "UV 6 High" and "Air fair";
 *  morning (07:30) is two MicroDatum, value only ("6 High", "Fair"). */
export const SUN_AIR_STD = {
  ordinary: { want: ["UV 6 High", "Air fair"] },
  morning: { want: ["6 High", "Fair"] },
  crowded: { want: ["UV 12 Extreme", "Air fair"] },
  "crowded-am": { want: ["12 Extreme", "Fair"] },
  "uv-past": { want: ["UV peaked 12 Extreme", "Air fair"] },
  tomorrow: { want: ["UV 12 Extreme tomorrow", "Air fair"] },
  worst: { want: ["UV 10 Very high tomorrow", "Air extremely poor"] },
  "air-poor-uv-low": { want: ["UV 2 Low", "Air poor"] },
  "uv-missing-air-moderate": { want: ["Air moderate"], not: ["UV"] },
  "air-missing-uv-9": { want: ["UV 9 Very high"], not: ["Air"] },
  quiet: { want: ["UV 2 Low"], not: ["Air"] },
};

/** Bin night (kiosk-bins). ONE date: the fake clock (binInstant) and every `night.date` below come from BIN_TODAY (a Monday), so a mocked
 *  "tonight" cannot drift off the clock. The evening states assert the line IS there, so the absence checks cannot pass with the feature broken.
 *  `at` is the local time in ZONE; `crowded` borrows the sun-air crowded weather (UV 12, the busiest below-band stack). */
export const BIN_TODAY = "2026-06-15";
export const BIN_PAST = "2026-06-14";
export const binInstant = (hhmm) => `${BIN_TODAY}T${hhmm}:00+10:00`;
const binsOk = (date, ...bins) => ({ status: "ok", today: BIN_TODAY, night: { date, bins } });
export const BIN_STATES = {
  evening: { at: "19:00", body: binsOk(BIN_TODAY, "Recycling"), want: "Recycling goes out tonight" },
  crowded: { at: "18:30", body: binsOk(BIN_TODAY, "Recycling"), want: "Recycling goes out tonight", crowded: true },
  "two-bin-fallback": { at: "19:00", body: binsOk(BIN_TODAY, "Garden organics", "General waste"), want: "Garden organics and General waste tonight" },
  // absent: the same moment and the same data as a present state, minus the thing that switches the line on
  quiet: { at: "19:00", body: { status: "ok", today: BIN_TODAY, night: null } },
  ordinary: { at: "11:00", body: binsOk(BIN_TODAY, "Recycling") },
  morning: { at: "07:30", body: binsOk(BIN_TODAY, "Recycling") },
  "crowded-am": { at: "07:30", body: binsOk(BIN_TODAY, "Recycling"), crowded: true },
  "fail-bins": { at: "19:00", body: { status: "error" } },
  "stale-bins": { at: "19:00", body: binsOk(BIN_PAST, "Recycling") }, // a payload whose date has passed
  unconf: { at: "19:00", body: { status: "unconfigured" } },
  "unconf-crowded": { at: "18:30", body: { status: "unconfigured" }, crowded: true }, // the baseline for the crowded Standard row (same weather, no rule)
  "night-wake": { at: "23:00", body: binsOk(BIN_TODAY, "Recycling") },
};
export const binWeatherFor = (state) => sunAirWeatherFor(BIN_STATES[state].crowded ? "crowded" : "ordinary");

/** The Bin night card's saved rules (Tuesday trucks; Garden's anchor is a Tuesday on the same week as 2026-06-16) and GET /api/settings around them. */
export const BIN_RULE_TWO = {
  collections: [
    { name: "Recycling", weekday: 2, every: 1 },
    { name: "Garden organics", weekday: 2, every: 2, anchor: "2026-11-03" },
  ],
};
/** Wednesday trucks: "Garden organics, General waste and Cans" would be a 47-character night (the card-level refusal). */
export const BIN_RULE_WED = {
  collections: [
    { name: "Garden organics", weekday: 3, every: 1 },
    { name: "General waste", weekday: 3, every: 1 },
  ],
};
export const settingsFullFor = (bins, calendar = CAL_UNSET) => ({
  config: { groups: [], urls: {}, icons: {}, hidden: [], widgets: [], display: { timezone: ZONE }, ...(bins ? { bins } : {}) },
  versions: { tiles: "1", widgets: "1" },
  meta: { widgetTypes: ["generic"], publicHost: "nightwatch.example", dockgeUrl: "http://dockge.example.invalid", authConfigured: true, dataDir: "/data", hermesModelUpdatedAt: null, mcpEnabled: false, mcpEndpoint: "", kioskPinConfigured: false },
  integrations: {
    homeassistant: { configured: false }, npm: { configured: false }, forgejo: { configured: false }, github: { configured: false },
    minecraft: { configured: false }, media: { configured: false }, calendar, hermes: { openrouterConfigured: false, anthropicConfigured: false },
  },
  system: { mcpTokenConfigured: false, kioskPinConfigured: false, hermesApiConfigured: false, voiceConfigured: false, oidcClientSecretConfigured: false },
  hermesDaemon: { discordWebhookConfigured: false, discordBotTokenConfigured: false, discordAllowedUserIds: [], updatedAt: null },
});

/** Kiosk calendar (kiosk-calendar). Invented events only; no link, address or host anywhere. ONE date: CAL_TODAY (a Monday) is the fake clock's
 *  day, so `at` pins the moment (Sydney, +10:00). Events carry an end, as the route serves them (all-day = local 00:00 to the next local 00:00).
 *  The route's order: all-day first, then start, then title. `crowded` is PLACEMENT.md's 18:30 evening; `six-four` is the shape brief's 11:00 worked example. */
export const CAL_TODAY = "2026-06-15";
export const CAL_TOMORROW = "2026-06-16";
export const calInstant = (hhmm) => `${CAL_TODAY}T${hhmm}:00+10:00`;
let calN = 0;
const calAt = (day, hhmm) => `${day}T${hhmm}:00+10:00`;
const ev = (day, from, to, title, o = {}) => ({ id: `cal-${calN++}`, title, busy: false, allDay: false, start: calAt(day, from), end: calAt(o.endDay ?? day, to), ...o.over });
const allDayEv = (day, nextDay, title) => ({ id: `cal-${calN++}`, title, busy: false, allDay: true, start: calAt(day, "00:00"), end: calAt(nextDay, "00:00") });
const calOk = (events, over = {}) => ({ status: "ok", stale: false, fetchedAt: `${CAL_TODAY}T06:00:00+10:00`, events, ...over });
const T = CAL_TODAY;
const M = CAL_TOMORROW;
const DENTIST = ev(M, "09:00", "10:00", "Dentist");
const SWIM = ev(T, "16:00", "17:00", "Swim lesson");
const CROWDED = [
  ev(T, "16:00", "18:45", "Swim lesson"), ev(T, "18:30", "19:30", "Book club"),
  ev(T, "19:15", "19:45", "Call with Gran"), ev(T, "20:00", "20:30", "Pick up Mika"), DENTIST,
];
/** `want` text must show in the pane and `std` rows in Standard (innerText; the pane caption is upper-cased by CSS). `pane: false` = the pane drops. */
export const CAL_STATES = {
  ordinary: { at: "11:00", body: calOk([SWIM, DENTIST]), want: ["NEXT UP", "4:00", "pm", "Swim lesson", "and 1 more tomorrow"], std: ["Today", "4:00 pm", "Swim lesson", "Tomorrow", "9:00 am", "Dentist"], rows: 2 },
  "on-now": { at: "18:30", body: calOk([ev(T, "16:00", "18:45", "Swim lesson"), DENTIST]), want: ["ON NOW", "Now", "Swim lesson", "till 6:45 pm", "and 1 more tomorrow"], std: ["now", "Swim lesson", "till 6:45 pm"], rows: 2 },
  "tomorrow-only": { at: "20:00", body: calOk([SWIM, DENTIST]), want: ["TOMORROW", "9:00", "am", "Dentist"], not: ["and"], std: ["Tomorrow", "9:00 am", "Dentist"], rows: 1 },
  crowded: { at: "18:30", crowded: true, body: calOk(CROWDED), want: ["ON NOW", "Now", "Swim lesson", "till 6:45 pm", "and 3 more today · 1 tomorrow"], std: ["Today", "now", "Swim lesson", "till 6:45 pm", "Book club", "till 7:30 pm", "7:15 pm", "Call with Gran", "and 1 more today · 1 tomorrow"], rows: 3, more: true },
  "six-four": {
    at: "11:00", crowded: true,
    body: calOk([
      ev(T, "12:30", "13:30", "Lunch with Ana"), ev(T, "14:00", "14:30", "School pickup"), ev(T, "15:15", "16:00", "Piano"),
      ev(T, "16:30", "17:30", "Swim lesson"), ev(T, "17:30", "18:30", "Book club"), ev(T, "19:00", "19:30", "Call with Gran"),
      DENTIST, ev(M, "10:30", "11:30", "Yoga class"), ev(M, "13:00", "13:30", "Library return"), ev(M, "18:00", "20:00", "Dinner at Mika's"),
    ]),
    want: ["NEXT UP", "12:30", "pm", "Lunch with Ana", "and 5 more today · 4 tomorrow"],
    std: ["Today", "12:30 pm", "Lunch with Ana", "2:00 pm", "School pickup", "3:15 pm", "Piano", "and 3 more today · 4 tomorrow"], rows: 3, more: true,
  },
  "long-title": { at: "11:00", body: calOk([ev(T, "15:00", "16:00", "Parent-teacher interviews at Bellwood Primary"), DENTIST]), want: ["NEXT UP", "3:00", "Parent-teacher interviews at Bellwood Primary"], std: ["3:00 pm", "Parent-teacher interviews at Bellwood Primary"], rows: 2 },
  // all-day first, a multi-day event already running (ends Wednesday), and a busy-only event
  mixed: {
    at: "08:00",
    body: calOk([
      allDayEv(T, CAL_TOMORROW, "Public holiday"), ev("2026-06-14", "10:00", "11:00", "Camping trip", { endDay: "2026-06-17" }),
      ev(T, "09:00", "10:00", null, { over: { busy: true } }), ev(T, "13:00", "13:30", "Alpha review"), DENTIST,
    ]),
    want: ["ON NOW", "Now", "Camping trip", "till Wed", "and 3 more today · 1 tomorrow"], std: ["Today", "All day", "Public holiday", "now", "Camping trip", "till Wed", "9:00 am", "Busy"], rows: 3, more: true,
  },
  // an untitled event and two at the same time
  gaps: { at: "12:00", body: calOk([ev(T, "13:00", "13:30", null), ev(T, "13:00", "13:30", "Alpha review"), ev(T, "13:00", "13:30", "Beta review")]), want: ["NEXT UP", "1:00", "No title", "and 2 more today"], std: ["1:00 pm", "No title", "Alpha review", "Beta review"], rows: 3 },
  stale: { at: "11:00", body: calOk([SWIM, DENTIST], { stale: true }), want: ["NEXT UP", "Swim lesson"], std: ["Swim lesson"], rows: 2, stale: true },
  // absent: nothing left today or tomorrow, not set up, and a feed that never read
  quiet: { at: "11:00", body: calOk([]), pane: false },
  unconf: { at: "11:00", body: { status: "unconfigured" }, pane: false },
  failed: { at: "11:00", body: { status: "error" }, pane: false, failedLine: true },
  // 22:30 is the night overlay; a wake tap runs Standard as the day: tomorrow's first event
  "woken-night": { at: "22:30", body: calOk([SWIM, DENTIST]), pane: false, std: ["Tomorrow", "9:00 am", "Dentist"], rows: 1 },
};
/** The weather behind a state: `crowded` borrows the sun-air crowded day (UV 12, the tallest Standard weather line); the rest are UV-quiet. */
export const calWeatherFor = (state) => sunAirWeatherFor(CAL_STATES[state].crowded ? "crowded" : "quiet");

/** GET /api/settings integrations.calendar for the settings card. Invented times: the fake clock is 2026-06-15 19:00 Sydney. */
export const CAL_UNSET = { configured: false, updatedAt: null, lastSyncAt: null, eventsThisWeek: null, problem: null };
const CAL_SET = { configured: true, updatedAt: "2026-06-13T09:00:00Z", lastSyncAt: "2026-06-15T08:40:00Z", eventsThisWeek: 14, problem: null };
export const CAL_SETTINGS = {
  empty: CAL_UNSET,
  configured: CAL_SET,
  warn: { ...CAL_SET, lastSyncAt: "2026-06-11T04:40:00Z", problem: "refused" }, // Thursday 2:40 pm Sydney
  replace: CAL_SET,
};
/** The longest of the server's fixed save errors (98 characters): the card must show it whole. */
export const CAL_LONGEST_ERROR = "That link opened, but it isn't a calendar. Copy the private calendar link, not the calendar's page.";
/** A draft made of words only: the settings captures never type a real link, and the save reply is mocked. */
export const CAL_DRAFT = "private-calendar-link-goes-here";
