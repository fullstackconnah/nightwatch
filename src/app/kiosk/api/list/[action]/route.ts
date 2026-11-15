import { NextRequest, NextResponse } from "next/server";
import { KIOSK_ELEVATION_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { handleListAction } from "@/lib/kiosk-list-store";
import { displayTimeZone } from "../tz";

export const dynamic = "force-dynamic";

/**
 * Public write surface for the wall's shared list. Cross-site POSTs are refused by middleware
 * (crossSiteWriteRefused); clear-all additionally checks the session or kiosk-elevation cookie in the store.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const contentLength = Number(req.headers.get("content-length"));
  const r = await handleListAction(action, {
    body: contentLength > 2048 ? "" : await req.text(), // the store refuses a declared-big body before parsing; do not buffer it
    contentLength,
    sessionCookie: req.cookies.get(SESSION_COOKIE)?.value,
    elevationCookie: req.cookies.get(KIOSK_ELEVATION_COOKIE)?.value,
    tz: displayTimeZone(),
    now: Date.now(),
  });
  return NextResponse.json(r.json, { status: r.status });
}
