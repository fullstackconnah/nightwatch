/* Fixtures for scripts/smarthome-shots.mjs: the /api/ha/states answers and the auto-off read for every state of the
 * pattern spec. Names are placeholders; nothing here names a real host. The browser clock is pinned to NOW (Sydney,
 * 22:00), so "turning off at 23:00" is an hour away and every age is exact. */

export const NOW = Date.parse("2026-10-15T22:00:00+11:00");

const light = (id, name, on, pct = null, available = true) => ({ entityId: `light.${id}`, name, on, brightnessPct: on ? pct : null, available });
const sw = (id, name, on, available = true) => ({ entityId: `switch.${id}`, name, on, available });
const lock = (state, name = "Front door") => ({ entityId: "lock.front_door", name, state, available: state !== "unavailable" });
const ac = (id, name, hvacMode, target, available = true) => ({
  entityId: `climate.${id}`, name, hvacMode, hvacModes: ["off", "cool", "heat", "auto"], currentTemp: 24.5, targetTemp: hvacMode === "off" ? null : target,
  targetTempLow: null, targetTempHigh: null, unit: "C", available,
});
const sensor = (id, name, kind, value, unit, available = true) => ({ entityId: `sensor.${id}`, name, kind, value, unit, available });

const entities = (over = {}) => ({
  lights: [light("hall", "Hallway", true, 60), light("lounge", "Lounge", false)],
  switches: [sw("fan", "Desk fan", false), sw("lamp", "Reading lamp", true)],
  climates: [ac("lounge", "Lounge AC", "cool", 23), ac("bed", "Bedroom AC", "off", 22), ac("study", "Study AC", "off", 22), ac("guest", "Guest AC", "off", 22)],
  locks: [lock("locked")],
  sensors: [sensor("t1", "Lounge temperature", "temperature", 24.5, "°C"), sensor("h1", "Lounge humidity", "humidity", 52, "%"), sensor("b1", "Door sensor battery", "battery", 88, "%")],
  scenes: [],
  mediaPlayers: [],
  ...over,
});
const ok = (over) => ({ status: "ok", entities: entities(over) });

export const AUTO_OFF = { enabled: true, time: "23:00", skipDate: null, lastRunDate: null };

// states: ha is the /api/ha/states body (or "hang" / "fail"); autoOff is the auto-off read (or "fail")
export const FIXTURES = {
  loading: { ha: "hang", autoOff: AUTO_OFF },
  unconfigured: { ha: { status: "unconfigured" }, autoOff: AUTO_OFF },
  tokenRejected: { ha: { status: "unauthorized", detail: "401 from 10.0.0.5:8123" }, autoOff: AUTO_OFF },
  unreachable: { ha: { status: "unreachable", detail: "connect ECONNREFUSED 10.0.0.5:8123" }, autoOff: AUTO_OFF },
  empty: { ha: ok({ lights: [], switches: [], climates: [], locks: [], sensors: [] }), autoOff: AUTO_OFF },
  calm: { ha: ok(), autoOff: AUTO_OFF },
  jammed: { ha: ok({ locks: [lock("jammed")] }), autoOff: AUTO_OFF },
  deviceDown: { ha: ok({ lights: [light("hall", "Hallway", true, 60), light("lounge", "Lounge", false, null, false)] }), autoOff: AUTO_OFF },
  lowBattery: { ha: ok({ sensors: [sensor("b1", "Door sensor battery", "battery", 14, "%")] }), autoOff: AUTO_OFF },
  noAutoOff: { ha: ok(), autoOff: "fail" },
};
