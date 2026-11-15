import { NextRequest, NextResponse } from "next/server";
import { KIOSK_ELEVATION_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { handleListAction, readListBody, MAX_BODY_BYTES } from "@/lib/kiosk-list-store";
import { displayTimeZone } from "../tz";

export const dynamic = "force-dynamic";

/**
 * Public write surface for the wall's shared list. Cross-site POSTs are refused by middleware
 * (crossSiteWriteRefused); clear-all additionally checks the session or kiosk-elevation cookie in the store.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const { body, tooLarge } = await readListBody(req);
  const r = await handleListAction(action, {
    body,
    contentLength: tooLarge ? MAX_BODY_BYTES + 1 : 0, // the store refuses an over-cap body before parsing
    sessionCookie: req.cookies.get(SESSION_COOKIE)?.value,
    elevationCookie: req.cookies.get(KIOSK_ELEVATION_COOKIE)?.value,
    tz: displayTimeZone(),
    now: Date.now(),
  });
  return NextResponse.json(r.json, { status: r.status });
}
