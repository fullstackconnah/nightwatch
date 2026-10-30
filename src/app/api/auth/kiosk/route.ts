import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  KIOSK_ELEVATION_COOKIE,
  KIOSK_ELEVATION_TTL_SECONDS,
  createKioskElevationToken,
  kioskElevationCookieOptions,
} from "@/lib/auth";
import { systemSetting } from "@/lib/config";
import { createKioskLockout } from "@/lib/kiosk-lockout";

export const dynamic = "force-dynamic";

// One global in-memory record, deliberately not per-IP: the only client
// identity here is a forwarded-address header the caller controls, so per-IP
// keying let rotating that header bypass the lockout. The kiosk is a
// single wall tablet, so a shared counter is enough (see lib/kiosk-lockout.ts
// for the escalation).
const lockout = createKioskLockout();

/** Hash-then-compare rather than a direct ===: not for secrecy (the PIN
 *  round-trips through the request body anyway) but so a wrong guess can't be
 *  timed by how many leading digits matched. */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export async function POST(req: NextRequest) {
  const locked = lockout.lockedUntil();
  if (locked) {
    return NextResponse.json(
      { error: "Too many attempts — locked out", lockedUntil: locked },
      { status: 429 },
    );
  }

  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  // Config-over-env: a PIN saved on the settings page's System card wins over
  // KIOSK_PIN. There is deliberately no built-in fallback — a default shipped
  // in source is a published credential, so an unconfigured install refuses
  // elevation outright instead of accepting one anyone can read.
  const expected = systemSetting("kioskPin", "KIOSK_PIN");
  if (!expected) {
    return NextResponse.json(
      { error: "Kiosk PIN not configured — set one on Settings → System" },
      { status: 503 },
    );
  }

  const ok = typeof pin === "string" && pin.length > 0 && safeEqual(pin, expected);

  if (!ok) {
    const lockedUntil = lockout.fail();
    return NextResponse.json(
      { error: "Incorrect PIN", lockedUntil: lockedUntil || undefined },
      { status: 401 },
    );
  }

  lockout.reset();
  const expiresAt = Date.now() + KIOSK_ELEVATION_TTL_SECONDS * 1000;
  const res = NextResponse.json({ ok: true, expiresAt });
  res.cookies.set(KIOSK_ELEVATION_COOKIE, await createKioskElevationToken(), kioskElevationCookieOptions());
  return res;
}
