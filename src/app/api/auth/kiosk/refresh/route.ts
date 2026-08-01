import { NextRequest, NextResponse } from "next/server";
import {
  KIOSK_ELEVATION_COOKIE,
  KIOSK_ELEVATION_TTL_SECONDS,
  createKioskElevationToken,
  kioskElevationCookieOptions,
  verifyKioskElevationToken,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Double duty: the kiosk page calls this once on mount to discover whether an
 * elevation from an earlier tap is still live (a tablet that reloads mid-session
 * shouldn't have to re-enter the PIN), and again on every interaction while
 * elevated, which is what "slides" the 5-minute window. Either way a fresh
 * token is minted on success so both callers get the same sliding behaviour
 * for free. Never errors on a missing/expired cookie — that's just "ambient",
 * not a failure.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(KIOSK_ELEVATION_COOKIE)?.value;
  const ok = await verifyKioskElevationToken(token);
  if (!ok) {
    return NextResponse.json({ elevated: false });
  }

  const expiresAt = Date.now() + KIOSK_ELEVATION_TTL_SECONDS * 1000;
  const res = NextResponse.json({ elevated: true, expiresAt });
  res.cookies.set(KIOSK_ELEVATION_COOKIE, await createKioskElevationToken(), kioskElevationCookieOptions());
  return res;
}
