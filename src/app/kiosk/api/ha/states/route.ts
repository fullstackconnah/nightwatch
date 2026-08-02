import { NextResponse } from "next/server";
import { getHaStates } from "@/lib/ha";
import type { HaStatesResponse } from "@/lib/ha-types";

export const dynamic = "force-dynamic";

/**
 * Public read-only HA snapshot for the kiosk smart-home panel. Deliberately a
 * separate route from /api/ha/states rather than reusing it: that route sits
 * behind the normal session gate, and this one is intentionally exempted in
 * middleware.ts (PUBLIC_PATHS matches "/kiosk", which covers "/kiosk/api/*")
 * so a wall tablet can drive lights/switches/scenes/climate without an admin
 * session. Locks are a physical-security boundary, not a kiosk concern — they
 * are stripped here even though getHaStates() still fetches them, so nothing
 * about lock state (locked/unlocked/jammed) ever reaches this public surface.
 */
export async function GET() {
  const result = await getHaStates();
  if (!result.entities) return NextResponse.json(result);

  const sanitized: HaStatesResponse = {
    ...result,
    entities: { ...result.entities, locks: [] },
  };
  return NextResponse.json(sanitized);
}
