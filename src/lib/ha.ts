import { loadConfig } from "@/lib/config";
import type {
  HaActionRequest,
  HaActionResult,
  HaClimate,
  HaEntities,
  HaLight,
  HaLock,
  HaLockState,
  HaScene,
  HaSensor,
  HaSensorKind,
  HaStatesResponse,
  HaSwitch,
} from "@/lib/ha-types";

/**
 * Server-only Home Assistant client. Credentials come from the top-level
 * `homeassistant` config block (see src/lib/config.ts) — same
 * not-a-widgets[]-entry reasoning as jellyfin.ts and the same shape of
 * distinguishable failure ("not configured" / "unreachable" / "unauthorized")
 * that widget already established.
 *
 * `GET /api/states` returns EVERY entity HA knows about — helpers, automations,
 * zones, `person.*`, integration diagnostics, all of it. This module strips
 * that down to the five domains the /smarthome panel renders and maps each one
 * into its own small typed shape; nothing outside those domains, and no raw HA
 * attribute blob, ever leaves getHaStates().
 */

const TIMEOUT_MS = 4000;

export interface HaCredentials {
  url: string;
  token: string;
}

/** Exported for src/lib/ha-doorbell.ts, which talks to HA endpoints this
 *  module has no business knowing about (`/api/camera_proxy*`) but must read
 *  the same single credential source — two copies of this drift the moment
 *  the config block gains a field. */
export function haCredentials(): HaCredentials | null {
  const cfg = loadConfig();
  const url = cfg.homeassistant?.url?.trim();
  const token = cfg.homeassistant?.token?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export const UNCONFIGURED_DETAIL =
  'No Home Assistant connection configured. In HA: Profile (bottom-left) → Security → ' +
  'Long-Lived Access Tokens → Create Token. Then add a "homeassistant" block to ' +
  "data/config.json on the server: " +
  '{ "homeassistant": { "url": "http://<ha-host>:8123", "token": "<the token>" } }';

// --- raw HA /api/states shape (only the fields this module reads) -----------

interface HaRawEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

// --- mapping helpers ----------------------------------------------------------

/** Returns null (never NaN) for anything that isn't a finite number — same
 *  contract as jellyfin.ts's numberOrNull, reused here for both numeric
 *  attributes and numeric-looking state strings (sensor states arrive as text). */
function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isUnavailable(state: string): boolean {
  return state === "unavailable" || state === "unknown";
}

/** True when both arrays have equal length and equal elements pairwise
 *  (callers pass lower-cased word arrays, so this is effectively the
 *  case-insensitive comparison). */
function wordsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/**
 * HA auto-generates `friendly_name` as "{area} {device}", and when a device's
 * own name already matches the area it lives in (e.g. an area named "Kitchen"
 * holding a climate device also named "Kitchen"), that concatenation doubles
 * the words: "Kitchen Kitchen", "Living Room Living Room", "Office AC Office
 * AC". This collapses that specific pattern before it ever reaches a
 * consumer, rather than leaving every card in the UI to render a doubled
 * label.
 *
 * Two shapes are collapsed:
 *  1. The whole name is two equal halves ("Kitchen Kitchen" -> "Kitchen"),
 *     including a repeated multi-word area like "Living Room Living Room".
 *  2. A repeated leading run followed by a distinct suffix ("Kitchen Kitchen
 *     Light" -> "Kitchen Light") — same doubling bug, with HA (or a device
 *     type) appending more text after the duplicated area+device pair.
 *
 * Comparison is case-insensitive; the returned string always keeps the
 * original casing of whichever words survive.
 *
 * Deliberately NOT collapsed: an odd-length name that is nothing but one
 * word repeated (e.g. "Bar Bar Bar") is ambiguous — HA's doubling bug always
 * produces exactly one duplicate, so a triple repeat isn't explained by it,
 * and guessing which copy to drop risks eating a real name. Left alone.
 *
 * Known limitation, accepted for a private homelab tool: a genuinely
 * doubled *real* name ("New York New York") collapses the same way a bug
 * artifact would. There's no way to tell them apart from the string alone.
 */
function collapseRepeatedName(rawName: string): string {
  // HA names can carry stray double spaces; collapse those defensively
  // without touching the actual words.
  const normalized = rawName.replace(/\s+/g, " ").trim();
  if (!normalized) return normalized;

  const words = normalized.split(" ");
  const n = words.length;
  if (n < 2) return normalized;

  const lower = words.map((w) => w.toLowerCase());

  // Shape 1: even word count, first half === second half.
  if (n % 2 === 0) {
    const half = n / 2;
    if (wordsEqual(lower.slice(0, half), lower.slice(half))) {
      return words.slice(0, half).join(" ");
    }
  }

  // A name that is only one word repeated end to end an odd number of
  // times (e.g. "Bar Bar Bar") is ambiguous — bail out rather than guess.
  if (n % 2 === 1 && lower.every((w) => w === lower[0])) {
    return normalized;
  }

  // Shape 2: repeated leading run + distinct suffix. Try the longest
  // possible run first so "Kitchen Kitchen Extra Words" still collapses to
  // the minimal duplicate.
  for (let k = Math.floor(n / 2); k >= 1; k--) {
    if (wordsEqual(lower.slice(0, k), lower.slice(k, 2 * k))) {
      return [...words.slice(0, k), ...words.slice(2 * k)].join(" ");
    }
  }

  return normalized;
}

function friendlyName(e: HaRawEntity): string {
  const name = e.attributes.friendly_name;
  if (typeof name !== "string" || !name) return e.entity_id;
  return collapseRepeatedName(name);
}

function stringAttr(attrs: Record<string, unknown>, key: string): string | null {
  const v = attrs[key];
  return typeof v === "string" && v ? v : null;
}

function mapLight(e: HaRawEntity): HaLight {
  const on = e.state === "on";
  const brightnessRaw = numberOrNull(e.attributes.brightness);
  return {
    entityId: e.entity_id,
    name: friendlyName(e),
    on,
    // 0-255 -> 0-100. Only meaningful while on and dimmable; off or non-dimmable
    // fixtures render "—" rather than a fabricated 0%.
    brightnessPct: on && brightnessRaw != null ? Math.round((brightnessRaw / 255) * 100) : null,
    available: !isUnavailable(e.state),
  };
}

function mapSwitch(e: HaRawEntity): HaSwitch {
  return {
    entityId: e.entity_id,
    name: friendlyName(e),
    on: e.state === "on",
    available: !isUnavailable(e.state),
  };
}

/** Filters an attribute HA documents as a string array down to actual
 *  strings, same defensive shape as hvac_modes below — an integration that
 *  reports a malformed list degrades to "no modes offered" rather than a
 *  crash or a mixed-type array reaching the client. */
function stringArrayAttr(attrs: Record<string, unknown>, key: string): string[] {
  const raw = attrs[key];
  return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === "string") : [];
}

function mapClimate(e: HaRawEntity): HaClimate {
  const attrs = e.attributes;
  const hvacModes = stringArrayAttr(attrs, "hvac_modes");

  // Optional extras: only set the key at all when HA actually reported the
  // attribute, so a unit that doesn't support (say) swing never carries a
  // fabricated swingMode/swingModes pair — the field is simply absent,
  // matching HaClimate's "optional, never null" contract for this group.
  const fanMode = stringAttr(attrs, "fan_mode");
  const fanModes = stringArrayAttr(attrs, "fan_modes");
  const presetMode = stringAttr(attrs, "preset_mode");
  const presetModes = stringArrayAttr(attrs, "preset_modes");
  const swingMode = stringAttr(attrs, "swing_mode");
  const swingModes = stringArrayAttr(attrs, "swing_modes");
  const minTemp = numberOrNull(attrs.min_temp);
  const maxTemp = numberOrNull(attrs.max_temp);
  const targetTempStep = numberOrNull(attrs.target_temp_step);

  return {
    entityId: e.entity_id,
    name: friendlyName(e),
    // Climate's own `state` IS its hvac mode (off/heat/cool/heat_cool/auto/dry/fan_only) —
    // there is no separate field for it.
    hvacMode: e.state,
    hvacModes,
    currentTemp: numberOrNull(attrs.current_temperature),
    targetTemp: numberOrNull(attrs.temperature),
    targetTempLow: numberOrNull(attrs.target_temp_low),
    targetTempHigh: numberOrNull(attrs.target_temp_high),
    unit: stringAttr(attrs, "unit_of_measurement"),
    available: !isUnavailable(e.state),
    ...(fanMode != null ? { fanMode } : {}),
    ...(fanModes.length > 0 ? { fanModes } : {}),
    ...(presetMode != null ? { presetMode } : {}),
    ...(presetModes.length > 0 ? { presetModes } : {}),
    ...(swingMode != null ? { swingMode } : {}),
    ...(swingModes.length > 0 ? { swingModes } : {}),
    ...(minTemp != null ? { minTemp } : {}),
    ...(maxTemp != null ? { maxTemp } : {}),
    ...(targetTempStep != null ? { targetTempStep } : {}),
  };
}

const KNOWN_LOCK_STATES: readonly HaLockState[] = [
  "locked",
  "unlocked",
  "locking",
  "unlocking",
  "jammed",
  "unavailable",
  "unknown",
];

function mapLock(e: HaRawEntity): HaLock {
  const state = (KNOWN_LOCK_STATES as readonly string[]).includes(e.state) ? (e.state as HaLockState) : "unknown";
  return {
    entityId: e.entity_id,
    name: friendlyName(e),
    state,
    available: state !== "unavailable",
  };
}

/** Compact read-only sensor set: only these three device classes are surfaced —
 *  everything else `sensor.*` reports (uptime counters, signal strength, raw
 *  diagnostics) is stripped rather than dumped onto the panel. */
const SENSOR_KIND_BY_DEVICE_CLASS: Record<string, HaSensorKind> = {
  temperature: "temperature",
  humidity: "humidity",
  battery: "battery",
};

function sensorKindOf(e: HaRawEntity): HaSensorKind | null {
  const dc = e.attributes.device_class;
  return typeof dc === "string" ? (SENSOR_KIND_BY_DEVICE_CLASS[dc] ?? null) : null;
}

function mapSensor(e: HaRawEntity, kind: HaSensorKind): HaSensor {
  const available = !isUnavailable(e.state);
  return {
    entityId: e.entity_id,
    name: friendlyName(e),
    kind,
    value: available ? numberOrNull(e.state) : null,
    unit: stringAttr(e.attributes, "unit_of_measurement"),
    available,
  };
}

function mapScene(e: HaRawEntity): HaScene {
  return {
    entityId: e.entity_id,
    name: friendlyName(e),
    // Scene's `state` is the ISO timestamp it last fired, never "unavailable"/
    // "unknown" in the on/off sense used elsewhere — isUnavailable still
    // applies, it just means the entity itself dropped off rather than "off".
    available: !isUnavailable(e.state),
  };
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

function buildEntities(raw: HaRawEntity[]): HaEntities {
  const lights: HaLight[] = [];
  const switches: HaSwitch[] = [];
  const climates: HaClimate[] = [];
  const locks: HaLock[] = [];
  const sensors: HaSensor[] = [];
  const scenes: HaScene[] = [];

  for (const e of raw) {
    if (typeof e?.entity_id !== "string") continue;
    const domain = e.entity_id.slice(0, e.entity_id.indexOf("."));
    switch (domain) {
      case "light":
        lights.push(mapLight(e));
        break;
      case "switch":
        switches.push(mapSwitch(e));
        break;
      case "climate":
        climates.push(mapClimate(e));
        break;
      case "lock":
        locks.push(mapLock(e));
        break;
      case "sensor": {
        const kind = sensorKindOf(e);
        if (kind) sensors.push(mapSensor(e, kind));
        break;
      }
      case "scene":
        scenes.push(mapScene(e));
        break;
      default:
        // Every other domain (automation, person, zone, update, ...) is dropped
        // here — deliberately never proxied to the client, wholesale or otherwise.
        break;
    }
  }

  return {
    lights: lights.sort(byName),
    switches: switches.sort(byName),
    climates: climates.sort(byName),
    locks: locks.sort(byName),
    sensors: sensors.sort(byName),
    scenes: scenes.sort(byName),
  };
}

// --- GET /api/states ------------------------------------------------------

export async function getHaStates(): Promise<HaStatesResponse> {
  const creds = haCredentials();
  if (!creds) return { status: "unconfigured", detail: UNCONFIGURED_DETAIL };

  let res: Response;
  try {
    res = await fetch(`${creds.url}/api/states`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return {
      status: "unreachable",
      detail: `Home Assistant at ${creds.url} did not respond within ${TIMEOUT_MS / 1000}s.`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      status: "unauthorized",
      detail: `Home Assistant rejected the access token (HTTP ${res.status}). Mint a fresh long-lived token in HA → Profile → Security and update data/config.json.`,
    };
  }
  if (!res.ok) {
    return { status: "unreachable", detail: `Home Assistant returned HTTP ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { status: "unreachable", detail: "Home Assistant returned a non-JSON response." };
  }
  if (!Array.isArray(body)) {
    return { status: "unreachable", detail: "Home Assistant /api/states did not return an array." };
  }

  return { status: "ok", entities: buildEntities(body as HaRawEntity[]) };
}

// --- POST /api/services/{domain}/{service} --------------------------------

async function callService(
  creds: HaCredentials,
  domain: string,
  service: string,
  entityId: string,
  data?: Record<string, unknown>,
): Promise<HaActionResult> {
  let res: Response;
  try {
    res = await fetch(`${creds.url}/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: "unreachable",
      detail: `Home Assistant at ${creds.url} did not respond within ${TIMEOUT_MS / 1000}s.`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: "unauthorized",
      detail: `Home Assistant rejected the access token (HTTP ${res.status}).`,
    };
  }
  if (res.status === 404) {
    return { ok: false, status: "invalid", detail: `Entity ${entityId} does not exist in Home Assistant.` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: "error",
      detail: `Home Assistant refused ${domain}.${service} (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : "."}`,
    };
  }
  return { ok: true };
}

/** Nearest half-degree — HA climate entities routinely reject arbitrary
 *  float precision, and a homelab thermostat has no use for a hundredth. */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * A temperature "nudge" has no direct HA service — it is read-current,
 * add-delta, write-back. Fetches the single entity's live state immediately
 * before writing so two nudges in quick succession compound off HA's own
 * number, not off a client-cached one that might already be stale.
 */
async function nudgeClimateTemp(creds: HaCredentials, entityId: string, delta: number): Promise<HaActionResult> {
  let res: Response;
  try {
    res = await fetch(`${creds.url}/api/states/${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: "unreachable",
      detail: `Home Assistant at ${creds.url} did not respond within ${TIMEOUT_MS / 1000}s.`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: "unauthorized",
      detail: `Home Assistant rejected the access token (HTTP ${res.status}).`,
    };
  }
  if (res.status === 404) {
    return { ok: false, status: "invalid", detail: `Entity ${entityId} does not exist in Home Assistant.` };
  }
  if (!res.ok) {
    return { ok: false, status: "unreachable", detail: `Home Assistant returned HTTP ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: "unreachable", detail: "Home Assistant returned a non-JSON response." };
  }
  const attrs = (body as { attributes?: Record<string, unknown> } | null)?.attributes ?? {};
  const single = numberOrNull(attrs.temperature);
  const low = numberOrNull(attrs.target_temp_low);
  const high = numberOrNull(attrs.target_temp_high);

  if (single != null) {
    return callService(creds, "climate", "set_temperature", entityId, { temperature: roundHalf(single + delta) });
  }
  if (low != null && high != null) {
    return callService(creds, "climate", "set_temperature", entityId, {
      target_temp_low: roundHalf(low + delta),
      target_temp_high: roundHalf(high + delta),
    });
  }
  return {
    ok: false,
    status: "invalid",
    detail: `${entityId} has no adjustable target temperature in its current mode.`,
  };
}

/**
 * Validates the request against its entity's own domain (never trusts the
 * client's claimed action-domain pairing) and dispatches to HA. Every branch
 * that fails returns ok:false with a status drawn from the same vocabulary
 * getHaStates() uses, so the client can render one consistent set of states.
 */
export async function performHaAction(req: HaActionRequest): Promise<HaActionResult> {
  const creds = haCredentials();
  if (!creds) return { ok: false, status: "unconfigured", detail: UNCONFIGURED_DETAIL };

  const dot = req.entityId.indexOf(".");
  const domain = dot > 0 ? req.entityId.slice(0, dot) : "";

  switch (req.action) {
    case "toggle":
      if (domain !== "light" && domain !== "switch") {
        return { ok: false, status: "invalid", detail: `toggle is not valid for entity domain "${domain || "?"}"` };
      }
      return callService(creds, domain, "toggle", req.entityId);

    case "lock":
    case "unlock":
      if (domain !== "lock") {
        return {
          ok: false,
          status: "invalid",
          detail: `${req.action} is not valid for entity domain "${domain || "?"}"`,
        };
      }
      return callService(creds, "lock", req.action, req.entityId);

    case "set_hvac_mode":
      if (domain !== "climate") {
        return {
          ok: false,
          status: "invalid",
          detail: `set_hvac_mode is not valid for entity domain "${domain || "?"}"`,
        };
      }
      if (!req.hvacMode) {
        return { ok: false, status: "invalid", detail: "set_hvac_mode requires hvacMode." };
      }
      return callService(creds, "climate", "set_hvac_mode", req.entityId, { hvac_mode: req.hvacMode });

    case "nudge_temp":
      if (domain !== "climate") {
        return { ok: false, status: "invalid", detail: `nudge_temp is not valid for entity domain "${domain || "?"}"` };
      }
      if (typeof req.delta !== "number" || !Number.isFinite(req.delta)) {
        return { ok: false, status: "invalid", detail: "nudge_temp requires a numeric delta." };
      }
      return nudgeClimateTemp(creds, req.entityId, req.delta);

    // Absolute counterpart to nudge_temp — see HaActionRequest.temperature's
    // comment for why both exist. No read-current step here: the caller
    // already knows the value it wants written.
    case "set_temp":
      if (domain !== "climate") {
        return { ok: false, status: "invalid", detail: `set_temp is not valid for entity domain "${domain || "?"}"` };
      }
      if (typeof req.temperature !== "number" || !Number.isFinite(req.temperature)) {
        return { ok: false, status: "invalid", detail: "set_temp requires a numeric temperature." };
      }
      return callService(creds, "climate", "set_temperature", req.entityId, { temperature: req.temperature });

    case "set_fan_mode":
      if (domain !== "climate") {
        return { ok: false, status: "invalid", detail: `set_fan_mode is not valid for entity domain "${domain || "?"}"` };
      }
      if (!req.fanMode) {
        return { ok: false, status: "invalid", detail: "set_fan_mode requires fanMode." };
      }
      return callService(creds, "climate", "set_fan_mode", req.entityId, { fan_mode: req.fanMode });

    case "set_preset_mode":
      if (domain !== "climate") {
        return {
          ok: false,
          status: "invalid",
          detail: `set_preset_mode is not valid for entity domain "${domain || "?"}"`,
        };
      }
      if (!req.presetMode) {
        return { ok: false, status: "invalid", detail: "set_preset_mode requires presetMode." };
      }
      return callService(creds, "climate", "set_preset_mode", req.entityId, { preset_mode: req.presetMode });

    case "set_swing_mode":
      if (domain !== "climate") {
        return {
          ok: false,
          status: "invalid",
          detail: `set_swing_mode is not valid for entity domain "${domain || "?"}"`,
        };
      }
      if (!req.swingMode) {
        return { ok: false, status: "invalid", detail: "set_swing_mode requires swingMode." };
      }
      return callService(creds, "climate", "set_swing_mode", req.entityId, { swing_mode: req.swingMode });

    case "activate_scene":
      if (domain !== "scene") {
        return {
          ok: false,
          status: "invalid",
          detail: `activate_scene is not valid for entity domain "${domain || "?"}"`,
        };
      }
      return callService(creds, "scene", "turn_on", req.entityId);

    default:
      return { ok: false, status: "invalid", detail: "Unknown action." };
  }
}
