import { NextResponse } from "next/server";
import { getHostVitals } from "@/lib/host-metrics";

export const dynamic = "force-dynamic";

/**
 * Public read-only host vitals for the ambient kiosk display. Deliberately a
 * separate route from /api/host rather than reusing it: that route sits
 * behind the normal session gate, and this one is intentionally exempted in
 * middleware.ts (PUBLIC_PATHS matches "/kiosk", which covers "/kiosk/api/*")
 * so a wall tablet can show vitals without an admin session. Returns the same
 * numbers /api/host does — never logs, secrets, or container detail.
 */
export async function GET() {
  try {
    return NextResponse.json(await getHostVitals());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "host metrics unavailable" },
      { status: 502 },
    );
  }
}
