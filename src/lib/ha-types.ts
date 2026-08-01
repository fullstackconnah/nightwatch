/**
 * Home Assistant entity-panel contract shared by the server fetcher
 * (src/lib/ha.ts), the API routes (src/app/api/ha/**) and the client hook
 * (src/lib/use-ha.ts). Imports NOTHING on purpose — same reasoning as
 * smart-types.ts and process-types.ts: a "use client" component that
 * value-imports a server module drags node:fs-adjacent code into the browser
 * bundle, and `tsc --noEmit` stays quiet about it while only `next build`
 * would fail.
 *
 * Honest-data rule, inherited from the rest of the app: a number that HA did
 * not report is `null`, never a fabricated 0 or omitted field silently.
 */

/** Distinguishes "no config.json block" from "HA didn't answer" from "HA said no" from a real snapshot. */
export type HaStatus = "unconfigured" | "unreachable" | "unauthorized" | "ok";

export interface HaLight {
  entityId: string;
  name: string;
  on: boolean;
  /** 0-100, rounded from HA's 0-255 `brightness` attribute. Null when the
   *  light reports no brightness (a plain on/off fixture) or is off/unavailable. */
  brightnessPct: number | null;
  available: boolean;
}

export interface HaSwitch {
  entityId: string;
  name: string;
  on: boolean;
  available: boolean;
}

/** Climate's own `state` field IS its hvac mode (off/heat/cool/heat_cool/auto/dry/fan_only). */
export interface HaClimate {
  entityId: string;
  name: string;
  hvacMode: string;
  /** Modes this entity accepts, from its own `hvac_modes` attribute — used to
   *  build the mode picker without hardcoding a universal list HA doesn't promise. */
  hvacModes: string[];
  currentTemp: number | null;
  /** Single-setpoint target (heat/cool/auto). Null when the entity uses a
   *  dual low/high range instead — see targetTempLow/High. */
  targetTemp: number | null;
  /** Dual-setpoint range, used by heat_cool mode. Both null outside that mode. */
  targetTempLow: number | null;
  targetTempHigh: number | null;
  unit: string | null;
  available: boolean;
}

export type HaLockState = "locked" | "unlocked" | "locking" | "unlocking" | "jammed" | "unavailable" | "unknown";

export interface HaLock {
  entityId: string;
  name: string;
  state: HaLockState;
  available: boolean;
}

export type HaSensorKind = "temperature" | "humidity" | "battery";

export interface HaSensor {
  entityId: string;
  name: string;
  kind: HaSensorKind;
  value: number | null;
  unit: string | null;
  available: boolean;
}

export interface HaEntities {
  lights: HaLight[];
  switches: HaSwitch[];
  climates: HaClimate[];
  locks: HaLock[];
  sensors: HaSensor[];
}

export interface HaStatesResponse {
  status: HaStatus;
  /** Human-readable explanation, always present when status !== "ok". */
  detail?: string;
  entities?: HaEntities;
}

export type HaActionName = "toggle" | "lock" | "unlock" | "set_hvac_mode" | "nudge_temp";

export interface HaActionRequest {
  entityId: string;
  action: HaActionName;
  /** Required for action === "set_hvac_mode". */
  hvacMode?: string;
  /** Required for action === "nudge_temp" — degrees to add (may be negative). */
  delta?: number;
}

export interface HaActionResult {
  ok: boolean;
  /** Present on failure; reuses HaStatus plus two request-shaped failure modes. */
  status?: HaStatus | "invalid" | "error";
  detail?: string;
}
