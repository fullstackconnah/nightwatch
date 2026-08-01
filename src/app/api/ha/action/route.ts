import { NextRequest, NextResponse } from "next/server";
import { performHaAction } from "@/lib/ha";
import type { HaActionName, HaActionRequest, HaActionResult } from "@/lib/ha-types";

export const dynamic = "force-dynamic";

// No auth check here beyond what already runs: src/middleware.ts gates every
// /api/** route (except /login and /api/auth/login) behind the admin session
// cookie before this handler ever executes — the exact same pattern the
// docker lifecycle POST routes (src/app/api/docker/containers/[id]/action)
// rely on. There is nothing to copy at the route level because there is
// nothing more to add.

const VALID_ACTIONS: readonly HaActionName[] = ["toggle", "lock", "unlock", "set_hvac_mode", "nudge_temp"];

function isValidBody(value: unknown): value is HaActionRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.entityId !== "string" || !v.entityId) return false;
  if (!(VALID_ACTIONS as readonly string[]).includes(v.action as string)) return false;
  if (v.hvacMode !== undefined && typeof v.hvacMode !== "string") return false;
  if (v.delta !== undefined && typeof v.delta !== "number") return false;
  return true;
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
  const body = await req.json().catch(() => null);
  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: `entityId (string) and action (one of ${VALID_ACTIONS.join("|")}) are required` },
      { status: 400 },
    );
  }

  const result = await performHaAction(body);
  if (result.ok) return NextResponse.json({ ok: true });

  return NextResponse.json(
    { error: result.detail ?? "Home Assistant action failed" },
    { status: statusCodeFor(result.status) },
  );
}
