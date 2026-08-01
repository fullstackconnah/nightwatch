import { NextResponse } from "next/server";
import { KIOSK_ELEVATION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Explicit "Lock" button on the kiosk admin panel: drop the elevation cookie
 *  immediately rather than waiting out the 5-minute expiry. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(KIOSK_ELEVATION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
