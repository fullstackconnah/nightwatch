import { NextResponse } from "next/server";
import { getBriefing } from "@/lib/briefing";

export const dynamic = "force-dynamic";

/**
 * Public morning-briefing card for the ambient kiosk display. Same exemption
 * as the rest of /kiosk/api/* (see middleware.ts's PUBLIC_PATHS). getBriefing()
 * never throws and never includes the Hermes bearer token or its base URL in
 * the shapes it returns (digest/news are plain text extracted server-side) —
 * this route still wraps it in try/catch as a last line of defense, since a
 * public unauthenticated route must never leak an unhandled error's stack or
 * message.
 */
export async function GET() {
  try {
    const result = await getBriefing();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { status: "unconfigured", date: new Date().toISOString().slice(0, 10), detail: "Briefing unavailable." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
