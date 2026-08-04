import { loadConfig } from "@/lib/config";
import { UNCONFIGURED_DETAIL, haCredentials, type HaCredentials } from "@/lib/ha";
import type {
  HaDoorbellCamera,
  HaDoorbellSnapshot,
  HaDoorbellTrigger,
  HaDoorbellTriggerKind,
} from "@/lib/ha-types";

/**
 * Server-only front-door camera resolver for the kiosk.
 *
 * Two jobs, deliberately in one file because the second depends on the first:
 *
 *  1. Work out WHICH entities are the front door — the cameras to show and the
 *     ding/person/motion entities whose firing should raise the modal. Nothing
 *     here is hardcoded to one house: config's `homeassistant.doorbell` block
 *     overrides everything, and with no config it's derived from HA's own
 *     entity naming (see resolve() below).
 *  2. Be the ONLY route by which camera bytes reach the kiosk, so the
 *     allowlist that job 1 produces is also the security boundary. /kiosk/**
 *     is unauthenticated on the LAN by design (middleware.ts PUBLIC_PATHS) —
 *     the same reason kiosk/api/ha/action carries its own domain allowlist
 *     rather than trusting ha.ts. A camera is a stronger privacy boundary
 *     than a light switch, so the rule here is narrower than "domain ===
 *     camera": only an entity this resolver named as a DOOR camera is
 *     proxyable, and an indoor camera HA also exposes is unreachable from the
 *     kiosk even if someone guesses its entity_id.
 *
 * The HA token never leaves the server — it is attached here and the response
 * body is piped through, which is also why the proxy exists at all rather than
 * the tablet talking to HA directly.
 */

const TIMEOUT_MS = 8000;

/** Longer than getHaStates()'s 4s: `/api/camera_proxy` wakes a battery
 *  doorbell and pulls a fresh frame from the vendor cloud, which measured
 *  0.7-0.9s warm on this setup and is documented to be much worse cold. */
const SNAPSHOT_TIMEOUT_MS = 15_000;

/** Several tablets (and the modal's own poll) hitting this at once shouldn't
 *  multiply the load on HA. Short enough that a ding is still detected within
 *  one client poll, long enough to collapse a burst. */
const STATES_CACHE_MS = 1500;

/** Two triggers firing within this window are the same real-world event seen
 *  by two devices (the bell's own ding and the camera's person detection).
 *  The higher-priority kind wins the `latest` slot so the modal can say
 *  "doorbell" rather than "motion" when both are true. */
const COINCIDENT_MS = 15_000;

interface RawEntity {
  entity_id: string;
  state: string;
  last_changed?: string;
  attributes: Record<string, unknown>;
}

let statesCache: { at: number; raw: RawEntity[] } | null = null;

async function fetchStates(creds: HaCredentials): Promise<RawEntity[] | { error: HaDoorbellSnapshot }> {
  const now = Date.now();
  if (statesCache && now - statesCache.at < STATES_CACHE_MS) return statesCache.raw;

  const fail = (status: HaDoorbellSnapshot["status"], detail: string): { error: HaDoorbellSnapshot } => ({
    error: { status, detail, cameras: [], triggers: [], latest: null, autoOpen: true, viewCamera: null },
  });

  let res: Response;
  try {
    res = await fetch(`${creds.url}/api/states`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return fail("unreachable", `Home Assistant at ${creds.url} did not respond within ${TIMEOUT_MS / 1000}s.`);
  }
  if (res.status === 401 || res.status === 403) {
    return fail("unauthorized", `Home Assistant rejected the access token (HTTP ${res.status}).`);
  }
  if (!res.ok) return fail("unreachable", `Home Assistant returned HTTP ${res.status}.`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fail("unreachable", "Home Assistant returned a non-JSON response.");
  }
  if (!Array.isArray(body)) return fail("unreachable", "Home Assistant /api/states did not return an array.");

  const raw = (body as RawEntity[]).filter((e) => typeof e?.entity_id === "string");
  statesCache = { at: now, raw };
  return raw;
}

// --- naming heuristics ------------------------------------------------------

function domainOf(entityId: string): string {
  const dot = entityId.indexOf(".");
  return dot > 0 ? entityId.slice(0, dot) : "";
}

function objectIdOf(entityId: string): string {
  const dot = entityId.indexOf(".");
  return dot > 0 ? entityId.slice(dot + 1) : entityId;
}

/** Stream-name suffixes vendors append to a camera entity so one device can
 *  expose several qualities. Stripping them recovers the DEVICE's own slug,
 *  which is what its sibling sensors are named after: Reolink's
 *  `camera.front_door_fluent` and `binary_sensor.front_door_person` are one
 *  device, and so are Ring's `camera.x_live_view` and `event.x_ding`. Longest
 *  first — `_live_view` must be tried before `_view` would be. */
const CAMERA_SUFFIXES = [
  "_live_view",
  "_last_recording",
  "_high_resolution_channel",
  "_low_resolution_channel",
  "_snapshots_clear",
  "_snapshots_fluent",
  "_sub_stream",
  "_main_stream",
  "_substream",
  "_mainstream",
  "_snapshot",
  "_balanced",
  "_fluent",
  "_clear",
  "_camera",
  "_stream",
  "_view",
  "_hd",
  "_sd",
] as const;

function deviceSlug(entityId: string): string {
  const obj = objectIdOf(entityId);
  for (const suffix of CAMERA_SUFFIXES) {
    if (obj.endsWith(suffix) && obj.length > suffix.length) return obj.slice(0, -suffix.length);
  }
  return obj;
}

/** A camera is a candidate for the kiosk when its id or friendly name reads
 *  like an entrance. This is the privacy default and it is intentionally
 *  conservative: an indoor camera named "Nursery" or "Lounge" matches nothing
 *  here and therefore never becomes reachable from the unauthenticated kiosk.
 *  Widen it by naming cameras explicitly in config, not by loosening this. */
const DOOR_WORDS = /door|bell|porch|entry|entrance|gate|drive|front|hall|foyer|step|street|outside/i;

/** Detections that are emphatically not "someone is at the door". A cat
 *  crossing the drive must not light up a wall tablet at 3am. */
const NOT_A_VISITOR = /_(animal|pet|vehicle|car|package|parcel|tamper|battery|sound|light|glass)$/;

function nameOf(e: RawEntity): string {
  const n = e.attributes.friendly_name;
  return typeof n === "string" && n ? n : e.entity_id;
}

function deviceClassOf(e: RawEntity): string {
  const dc = e.attributes.device_class;
  return typeof dc === "string" ? dc : "";
}

/**
 * Which kind of "someone's there" signal an entity is, or null if it isn't
 * one. Order matters: the suffix test runs before device_class because Ring's
 * legacy ding sensor carries device_class `occupancy`, which would otherwise
 * read as a bare presence detection and lose the fact that the BELL rang.
 */
function triggerKindOf(e: RawEntity): HaDoorbellTriggerKind | null {
  const obj = objectIdOf(e.entity_id);
  const domain = domainOf(e.entity_id);
  const dc = deviceClassOf(e);

  if (NOT_A_VISITOR.test(obj)) return null;

  if (obj.endsWith("_ding") || obj.endsWith("_doorbell") || obj.endsWith("_button_pressed")) return "ding";
  if (dc === "doorbell") return "ding";
  if (obj.endsWith("_person") || obj.endsWith("_visitor") || dc === "occupancy") return "person";
  if (obj.endsWith("_motion") || dc === "motion") return "motion";
  // A timestamp sensor is only a trigger in the one shape vendors use it for:
  // "when did this device last do anything". Any other timestamp sensor
  // (next sunrise, last restart) would fire the modal on a schedule.
  if (domain === "sensor" && dc === "timestamp" && /_last_(activity|event|motion|ding)$/.test(obj)) return "activity";

  return null;
}

const KIND_RANK: Record<HaDoorbellTriggerKind, number> = { ding: 3, person: 2, motion: 1, activity: 0 };

function isoOrNull(value: string): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Turns one raw entity into a trigger reading.
 *
 * The `firedAt` rule for binary sensors is the load-bearing decision here: a
 * sensor reports only its LAST change, so while it reads "off" the timestamp
 * available is when the detection ENDED, not when it began. Publishing that
 * would hand the client a brand-new timestamp every time motion clears — the
 * modal would reopen the moment it was dismissed, forever. So an `off` sensor
 * reports firedAt: null and simply says nothing, and detection relies on the
 * poll landing during the `on` window (seconds long at minimum, against a 3s
 * poll). Event and timestamp entities have no such ambiguity: their state IS
 * the instant, and it only ever moves forward.
 */
function readTrigger(e: RawEntity, kind: HaDoorbellTriggerKind, serverNow: number): HaDoorbellTrigger | null {
  const domain = domainOf(e.entity_id);
  const unavailable = e.state === "unavailable" || e.state === "unknown";

  let firedAt: string | null = null;
  let active = false;

  if (domain === "binary_sensor") {
    active = e.state === "on";
    firedAt = active ? isoOrNull(e.last_changed ?? "") : null;
  } else if (domain === "event" || domain === "sensor") {
    firedAt = unavailable ? null : isoOrNull(e.state);
  } else {
    return null;
  }

  const firedMs = firedAt ? Date.parse(firedAt) : NaN;
  return {
    entityId: e.entity_id,
    name: nameOf(e),
    kind,
    active,
    firedAt,
    ageSec: Number.isFinite(firedMs) ? Math.max(0, Math.round((serverNow - firedMs) / 1000)) : null,
  };
}

/** Newest wins, except that two readings close enough together to be the same
 *  real event are settled by kind instead — see COINCIDENT_MS. */
function pickLatest(triggers: HaDoorbellTrigger[]): HaDoorbellTrigger | null {
  const fired = triggers.filter((t) => t.firedAt !== null && t.ageSec !== null);
  if (fired.length === 0) return null;
  const freshest = Math.min(...fired.map((t) => t.ageSec as number));
  const coincident = fired.filter((t) => (t.ageSec as number) - freshest <= COINCIDENT_MS / 1000);
  return coincident.reduce((best, t) => (KIND_RANK[t.kind] > KIND_RANK[best.kind] ? t : best));
}

// --- resolution -------------------------------------------------------------

function configuredDoorbell() {
  return loadConfig().homeassistant?.doorbell ?? {};
}

/**
 * Picks the door cameras and their triggers out of a full entity list.
 *
 * Auto-detection, when config names nothing:
 *  - cameras: every `camera.*` whose entity_id or friendly name reads like an
 *    entrance (DOOR_WORDS). Ordered so an entity that actually says "doorbell"
 *    sorts ahead of a camera that merely lives near the door — when the bell
 *    rings, the bell's own view is the one to open on.
 *  - triggers: every ding/person/motion/activity entity whose object_id starts
 *    with one of those cameras' DEVICE slug. The slug tie is what stops a
 *    bedroom motion sensor from raising the front-door modal; a trigger with
 *    no camera to belong to is not a door trigger.
 *
 * Explicit config skips the heuristic for whichever list it names — cameras
 * and triggers independently, so naming an odd camera doesn't also force you
 * to enumerate its sensors.
 */
function resolve(raw: RawEntity[], serverNow: number): { cameras: HaDoorbellCamera[]; triggers: HaDoorbellTrigger[] } {
  const cfg = configuredDoorbell();
  const byId = new Map(raw.map((e) => [e.entity_id, e]));

  const configuredCameras = (cfg.cameras ?? []).filter((id) => domainOf(id) === "camera");
  let cameraEntities: RawEntity[];

  if (configuredCameras.length > 0) {
    // A configured camera HA doesn't currently report still counts — it is
    // rendered as unavailable rather than silently dropped, so a typo or an
    // integration that's down looks different from "not configured".
    cameraEntities = configuredCameras.map(
      (id) => byId.get(id) ?? { entity_id: id, state: "unavailable", attributes: {} },
    );
  } else {
    cameraEntities = raw
      .filter((e) => domainOf(e.entity_id) === "camera")
      .filter((e) => DOOR_WORDS.test(e.entity_id) || DOOR_WORDS.test(nameOf(e)))
      .sort((a, b) => {
        const bellish = (e: RawEntity) => (/bell/i.test(e.entity_id) || /bell/i.test(nameOf(e)) ? 0 : 1);
        return bellish(a) - bellish(b) || a.entity_id.localeCompare(b.entity_id);
      });
  }

  const cameras: HaDoorbellCamera[] = cameraEntities.map((e) => ({
    entityId: e.entity_id,
    name: nameOf(e),
    available: e.state !== "unavailable" && e.state !== "unknown",
  }));

  const configuredTriggers = cfg.triggers ?? [];
  const triggerEntities =
    configuredTriggers.length > 0
      ? configuredTriggers.map((id) => byId.get(id)).filter((e): e is RawEntity => e !== undefined)
      : (() => {
          const slugs = cameraEntities.map((e) => deviceSlug(e.entity_id));
          return raw.filter((e) => {
            const obj = objectIdOf(e.entity_id);
            return slugs.some((s) => s && (obj === s || obj.startsWith(`${s}_`)));
          });
        })();

  const triggers: HaDoorbellTrigger[] = [];
  for (const e of triggerEntities) {
    const kind = triggerKindOf(e);
    if (!kind) continue;
    const t = readTrigger(e, kind, serverNow);
    if (t) triggers.push(t);
  }

  return { cameras, triggers };
}

/** The kiosk's poll target: small enough to hit every few seconds, and it
 *  answers both "is anyone at the door" and "which cameras may I ask for". */
export async function getDoorbellSnapshot(): Promise<HaDoorbellSnapshot> {
  const creds = haCredentials();
  const cfg = configuredDoorbell();
  const autoOpen = cfg.autoOpen !== false;
  if (!creds) {
    return {
      status: "unconfigured",
      detail: UNCONFIGURED_DETAIL,
      cameras: [],
      triggers: [],
      latest: null,
      autoOpen,
      viewCamera: null,
    };
  }

  const raw = await fetchStates(creds);
  if (!Array.isArray(raw)) return { ...raw.error, autoOpen };

  const serverNow = Date.now();
  const { cameras, triggers } = resolve(raw, serverNow);

  // Only honoured when it names a camera this resolver already allows — see
  // HaDoorbellSnapshot.viewCamera. An unavailable camera still counts: it is
  // the view the house has chosen, and rendering its outage is more honest than
  // silently showing a different doorway.
  const pinned = cfg.viewCamera?.trim();
  const viewCamera = pinned && cameras.some((c) => c.entityId === pinned) ? pinned : null;

  return { status: "ok", cameras, triggers, latest: pickLatest(triggers), autoOpen, viewCamera };
}

/** True only for a camera THIS resolver named — the allowlist described in the
 *  file header. Deliberately re-resolves (through the 1.5s states cache)
 *  rather than trusting a list the client sends back. */
export async function isProxyableCamera(entityId: string): Promise<boolean> {
  const creds = haCredentials();
  if (!creds) return false;
  const raw = await fetchStates(creds);
  if (!Array.isArray(raw)) return false;
  return resolve(raw, Date.now()).cameras.some((c) => c.entityId === entityId);
}

export type CameraMode = "stream" | "snapshot";

/**
 * Opens the upstream camera response for piping. Returns the raw Response so
 * the route can hand `body` straight to the client without buffering a video
 * stream through memory.
 *
 * `signal` must be the incoming request's own AbortSignal: an MJPEG response
 * never ends on its own, so the only thing that stops HA streaming (and, for a
 * battery doorbell, stops it draining) is the tablet closing the connection
 * propagating through to the upstream fetch. A timeout signal cannot be used
 * for that mode — it would cut the picture off mid-view.
 */
export async function openCamera(
  entityId: string,
  mode: CameraMode,
  signal: AbortSignal,
): Promise<Response | { error: string; status: number }> {
  const creds = haCredentials();
  if (!creds) return { error: "Home Assistant is not configured.", status: 409 };

  const path = mode === "stream" ? "camera_proxy_stream" : "camera_proxy";
  let res: Response;
  try {
    res = await fetch(`${creds.url}/api/${path}/${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      // Snapshot gets a deadline; stream gets only the client's own lifetime.
      signal: mode === "stream" ? signal : AbortSignal.any([signal, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)]),
      cache: "no-store",
    });
  } catch {
    return { error: `Home Assistant did not return a picture for ${entityId}.`, status: 502 };
  }

  if (res.status === 401 || res.status === 403) {
    return { error: "Home Assistant rejected the access token.", status: 502 };
  }
  if (!res.ok || !res.body) {
    return { error: `Home Assistant returned HTTP ${res.status} for ${entityId}.`, status: 502 };
  }
  return res;
}
