import { NextResponse } from "next/server";
import { getHaStates, getHiddenSettingsIds } from "@/lib/ha";
import { readHiddenFailOpen, withoutSettingsEntities } from "@/lib/ha-settings-entities";
import type { HaStatesResponse } from "@/lib/types/ha";

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
  // Parallel: the registry read must not add its latency to the states fetch.
  const [result, hidden] = await Promise.all([getHaStates(), readHiddenFailOpen(getHiddenSettingsIds)]);
  if (!result.entities) return NextResponse.json(result);

  // Wall kiosk shows daily controls only: HA config/diagnostic entities (camera
  // "Email on event", "FTP upload"...) are hidden. /smarthome is unfiltered.
  const sanitized: HaStatesResponse = {
    ...result,
    entities: withoutSettingsEntities({ ...result.entities, locks: [] }, hidden),
  };
  return NextResponse.json(sanitized);
}
