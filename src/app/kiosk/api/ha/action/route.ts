import { NextRequest, NextResponse } from "next/server";
import { performHaAction } from "@/lib/ha";
import type { HaActionRequest, HaActionResult } from "@/lib/ha-types";

export const dynamic = "force-dynamic";

/**
 * Public write surface for the kiosk smart-home panel — reachable with no
 * session (see middleware.ts PUBLIC_PATHS: "/kiosk" covers "/kiosk/api/*").
 * Because this is unauthenticated on the LAN, it carries its OWN allowlist
 * below rather than trusting performHaAction()'s domain checks alone —
 * defense in depth, so a bug or future loosening in ha.ts can't quietly
 * widen what an anonymous device on the network can do.
 *
 * "lock" / "unlock" are excluded on purpose and permanently: locks are a
 * physical-security boundary (who can get into the house), not a comfort
 * control like a light or thermostat, and they are deliberately not exposed
 * on the kiosk at all — see the top-level task brief. Do not add them here.
 */

const PUBLIC_ACTIONS = [
  "toggle",
  "activate_scene",
  "set_hvac_mode",
  "nudge_temp",
  "set_temp",
  "set_fan_mode",
  "set_preset_mode",
  "set_swing_mode",
] as const;
type PublicHaAction = (typeof PUBLIC_ACTIONS)[number];

/** Domains the kiosk is allowed to touch at all. Locks are never in this
 *  list — see file header. Anything else HA exposes (automation, person,
 *  camera, ...) was never reachable from here to begin with. */
const ALLOWED_DOMAINS = new Set(["light", "switch", "scene", "climate"]);

const ENTITY_ID_RE = /^[a-z_]+\.[a-zA-Z0-9_]+$/;

/** Nudge is a relative adjustment, not an absolute setpoint — a wall tablet
 *  fat-fingering repeated taps should never be able to walk a thermostat
 *  more than 2 degrees in one request. */
const MAX_NUDGE_DELTA = 2;
const MAX_HVAC_MODE_LEN = 30;

/** Absolute backstop for set_temp, independent of whatever min/max a given
 *  entity advertises (this route never looks those up — it has no read
 *  path to HA, only write). Same defense-in-depth reasoning as
 *  MAX_NUDGE_DELTA: a client bug or a fat-fingered tablet must not be able
 *  to ask HA for a temperature no sane thermostat in this house would ever
 *  want, even if HA itself would reject something further out. */
const MIN_SET_TEMP = 5;
const MAX_SET_TEMP = 35;

/** Fan/preset/swing mode names are per-unit ("Level 1".."Level 7", "Auto",
 *  "eco", "sleep") — this route doesn't know a fixed list to validate
 *  against, so it only bounds the shape (non-empty, capped length) the same
 *  way MAX_HVAC_MODE_LEN does for hvacMode, and leaves HA to reject a value
 *  a given unit doesn't actually support. */
const MAX_MODE_NAME_LEN = 30;

interface KioskHaActionBody {
  action: PublicHaAction;
  entityId: string;
  hvacMode?: string;
  delta?: number;
  temperature?: number;
  fanMode?: string;
  presetMode?: string;
  swingMode?: string;
}

function validationError(detail: string): NextResponse {
  return NextResponse.json({ error: detail }, { status: 400 });
}

function parseBody(value: unknown): KioskHaActionBody | { error: string } {
  if (!value || typeof value !== "object") return { error: "Request body must be a JSON object." };
  const v = value as Record<string, unknown>;

  if (!(PUBLIC_ACTIONS as readonly string[]).includes(v.action as string)) {
    return { error: `action must be one of: ${PUBLIC_ACTIONS.join(", ")}.` };
  }
  const action = v.action as PublicHaAction;

  if (typeof v.entityId !== "string" || !ENTITY_ID_RE.test(v.entityId)) {
    return { error: "entityId must look like <domain>.<object_id>." };
  }
  const entityId = v.entityId;
  const domain = entityId.slice(0, entityId.indexOf("."));
  if (!ALLOWED_DOMAINS.has(domain)) {
    return { error: `entityId domain "${domain}" is not exposed on the kiosk.` };
  }

  let hvacMode: string | undefined;
  if (action === "set_hvac_mode") {
    if (typeof v.hvacMode !== "string" || !v.hvacMode || v.hvacMode.length > MAX_HVAC_MODE_LEN) {
      return { error: `hvacMode must be a non-empty string of at most ${MAX_HVAC_MODE_LEN} characters.` };
    }
    hvacMode = v.hvacMode;
  }

  let delta: number | undefined;
  if (action === "nudge_temp") {
    if (typeof v.delta !== "number" || !Number.isFinite(v.delta)) {
      return { error: "delta must be a finite number." };
    }
    if (Math.abs(v.delta) > MAX_NUDGE_DELTA) {
      return { error: `delta must not exceed ${MAX_NUDGE_DELTA} degrees per request.` };
    }
    delta = v.delta;
  }

  let temperature: number | undefined;
  if (action === "set_temp") {
    if (typeof v.temperature !== "number" || !Number.isFinite(v.temperature)) {
      return { error: "temperature must be a finite number." };
    }
    if (v.temperature < MIN_SET_TEMP || v.temperature > MAX_SET_TEMP) {
      return { error: `temperature must be between ${MIN_SET_TEMP} and ${MAX_SET_TEMP} degrees.` };
    }
    temperature = v.temperature;
  }

  let fanMode: string | undefined;
  if (action === "set_fan_mode") {
    if (typeof v.fanMode !== "string" || !v.fanMode || v.fanMode.length > MAX_MODE_NAME_LEN) {
      return { error: `fanMode must be a non-empty string of at most ${MAX_MODE_NAME_LEN} characters.` };
    }
    fanMode = v.fanMode;
  }

  let presetMode: string | undefined;
  if (action === "set_preset_mode") {
    if (typeof v.presetMode !== "string" || !v.presetMode || v.presetMode.length > MAX_MODE_NAME_LEN) {
      return { error: `presetMode must be a non-empty string of at most ${MAX_MODE_NAME_LEN} characters.` };
    }
    presetMode = v.presetMode;
  }

  let swingMode: string | undefined;
  if (action === "set_swing_mode") {
    if (typeof v.swingMode !== "string" || !v.swingMode || v.swingMode.length > MAX_MODE_NAME_LEN) {
      return { error: `swingMode must be a non-empty string of at most ${MAX_MODE_NAME_LEN} characters.` };
    }
    swingMode = v.swingMode;
  }

  return { action, entityId, hvacMode, delta, temperature, fanMode, presetMode, swingMode };
}

function statusCodeFor(status: HaActionResult["status"]): number {
  switch (status) {
    case "unconfigured":
      return 409; // nothing to talk to yet — a config problem, not a transient one
    case "unreachable":
      return 502;
    case "unauthorized":
      return 401;
    case "invalid":
      return 400;
    case "error":
    default:
      return 500;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const parsed = parseBody(raw);
  if ("error" in parsed) return validationError(parsed.error);

  const actionReq: HaActionRequest = {
    entityId: parsed.entityId,
    action: parsed.action,
    hvacMode: parsed.hvacMode,
    delta: parsed.delta,
    temperature: parsed.temperature,
    fanMode: parsed.fanMode,
    presetMode: parsed.presetMode,
    swingMode: parsed.swingMode,
  };

  const result = await performHaAction(actionReq);
  if (result.ok) return NextResponse.json({ ok: true });

  return NextResponse.json(
    { error: result.detail ?? "Home Assistant action failed" },
    { status: statusCodeFor(result.status) },
  );
}
