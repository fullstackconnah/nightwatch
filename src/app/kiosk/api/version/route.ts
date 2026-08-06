import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/build-id";

export const dynamic = "force-dynamic";

/**
 * Public build-id check for the kiosk's "Check for updates" button. Same
 * exemption as the rest of /kiosk/api/* (see middleware.ts's PUBLIC_PATHS) —
 * a short-commit-hash string carries nothing sensitive. no-store on top of
 * `dynamic = "force-dynamic"` so a stale cached response never masks a real
 * update: the whole point of this route is to answer with what's running
 * on the server right now, not what was true a request ago.
 */
export async function GET() {
  return NextResponse.json({ buildId: BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
