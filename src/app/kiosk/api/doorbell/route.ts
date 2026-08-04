import { NextResponse } from "next/server";
import { getDoorbellSnapshot } from "@/lib/ha-doorbell";

export const dynamic = "force-dynamic";

/**
 * Public read-only front-door state for the kiosk — reachable with no session
 * (middleware.ts PUBLIC_PATHS matches "/kiosk", which covers "/kiosk/api/*"),
 * same as the vitals/health/ha-states routes beside it.
 *
 * Kept separate from /kiosk/api/ha/states rather than folded into it because
 * this is polled several times a minute (a doorbell answered thirty seconds
 * late is not a doorbell) while that one is polled for a control panel. The
 * payload here is a few hundred bytes; ha/states is the whole smart home.
 * src/lib/ha-doorbell.ts caches the upstream fetch so the two polls together
 * still can't hammer HA.
 *
 * Always 200 for the same reason /api/ha/states is: an unreachable or
 * unauthorized HA is a snapshot state the UI renders, and a real 401 here
 * would make src/lib/client.ts's fetcher redirect the wall tablet to /login.
 */
export async function GET() {
  const snapshot = await getDoorbellSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
