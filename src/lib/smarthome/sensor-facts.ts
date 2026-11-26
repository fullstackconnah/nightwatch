// Pure and type-import-only: the Smart home page (client) and the Home attention probe share these two definitions.
import type { HaSensor } from "../types/ha.ts";

/** The page names a battery at 20 or less and turns the strip red at 10 or less. */
export const BATTERY_LOW = 20;
export const BATTERY_BAD = 10;

/** Batteries with a reading at or under `max`, lowest first. */
export const lowBatteries = (sensors: readonly HaSensor[], max: number = BATTERY_LOW): HaSensor[] =>
  sensors
    .filter((s) => s.kind === "battery" && s.available && s.value != null && s.value <= max)
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));

/** Shared sensors Home Assistant has no reading from (the page's "not answering"); a battery with no number (text state) counts too. */
export const countSensorsDown = (sensors: readonly HaSensor[]): number => sensors.filter((s) => !s.available || (s.kind === "battery" && s.value == null)).length;
