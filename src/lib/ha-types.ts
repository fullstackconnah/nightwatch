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

/** Scene's own `state` is the timestamp it was last activated, not a status —
 *  there is no "on/off" for a scene, only "exists and can be fired". */
export interface HaScene {
  entityId: string;
  name: string;
  available: boolean;
}

export interface HaEntities {
  lights: HaLight[];
  switches: HaSwitch[];
  climates: HaClimate[];
  locks: HaLock[];
  sensors: HaSensor[];
  scenes: HaScene[];
}

export interface HaStatesResponse {
  status: HaStatus;
  /** Human-readable explanation, always present when status !== "ok". */
  detail?: string;
  entities?: HaEntities;
}

/* ── front-door camera ─────────────────────────────────────────────────────
   Deliberately NOT folded into HaEntities: `camera` and `binary_sensor` stay
   stripped from buildEntities() (see ha.ts's domain switch), because the
   /smarthome panel and the kiosk's smart-home hub both render every domain
   they're handed, and a camera is not a control. This is a separate, narrower
   contract fetched by its own route for its own surface — which is also what
   lets the public proxy allowlist be exactly "the cameras this resolver
   named", rather than "any camera HA happens to expose". */

/** Why the modal opened. `ding` is the bell itself; `person` is an AI person
 *  detection; `motion` is bare movement; `activity` is a vendor's catch-all
 *  last-activity timestamp (Ring exposes one, and on this house's setup it's
 *  the only Ring signal that isn't `unavailable`). Ranked in that order when
 *  two fire together — being rung beats being walked past. */
export type HaDoorbellTriggerKind = "ding" | "person" | "motion" | "activity";

export interface HaDoorbellCamera {
  entityId: string;
  name: string;
  available: boolean;
}

export interface HaDoorbellTrigger {
  entityId: string;
  name: string;
  kind: HaDoorbellTriggerKind;
  /** Currently held on (a binary_sensor mid-detection). Momentary event
   *  entities are never `active` — they only ever report a timestamp. */
  active: boolean;
  /** ISO instant this trigger last fired, straight from HA (`last_changed`
   *  for binary sensors, the state itself for event/timestamp entities).
   *  Null when it has never fired or is unavailable. */
  firedAt: string | null;
  /** Seconds since `firedAt`, computed against the SERVER's clock. The kiosk
   *  tablet's own clock can't be trusted to be in sync with HA's, and "is this
   *  ding fresh enough to interrupt someone" must not hinge on that. */
  ageSec: number | null;
}

export interface HaDoorbellSnapshot {
  status: HaStatus;
  detail?: string;
  /** Empty when HA is reachable but nothing door-shaped was found — a real
   *  answer ("no door camera here"), distinct from a status failure. */
  cameras: HaDoorbellCamera[];
  triggers: HaDoorbellTrigger[];
  /** The freshest trigger across `triggers`, or null if none has ever fired.
   *  Precomputed here so every client doesn't re-derive the same ranking. */
  latest: HaDoorbellTrigger | null;
  /** Mirrors config's homeassistant.doorbell.autoOpen (default true). */
  autoOpen: boolean;
  /** Config's homeassistant.doorbell.viewCamera, but only when it names one of
   *  `cameras` above — validated here rather than client-side so a typo reads
   *  as "no pin" (fall back to device pairing) instead of an empty panel, and so
   *  the pin can never name a camera the proxy would refuse anyway. */
  viewCamera: string | null;
}

export type HaActionName = "toggle" | "lock" | "unlock" | "set_hvac_mode" | "nudge_temp" | "activate_scene";

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
