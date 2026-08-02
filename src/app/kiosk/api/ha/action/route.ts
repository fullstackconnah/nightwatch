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

const PUBLIC_ACTIONS = ["toggle", "activate_scene", "set_hvac_mode", "nudge_temp"] as const;
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

interface KioskHaActionBody {
  action: PublicHaAction;
  entityId: string;
  hvacMode?: string;
  delta?: number;
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

  return { action, entityId, hvacMode, delta };
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
  };

  const result = await performHaAction(actionReq);
  if (result.ok) return NextResponse.json({ ok: true });

  return NextResponse.json(
    { error: result.detail ?? "Home Assistant action failed" },
    { status: statusCodeFor(result.status) },
  );
}
