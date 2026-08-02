import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  KIOSK_ELEVATION_COOKIE,
  KIOSK_ELEVATION_TTL_SECONDS,
  createKioskElevationToken,
  kioskElevationCookieOptions,
} from "@/lib/auth";
import { systemSetting } from "@/lib/config";

export const dynamic = "force-dynamic";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;

interface Attempt {
  failures: number;
  lockedUntil: number;
}

// Per-IP, in-memory — the kiosk is a single wall tablet on the LAN, not a
// public login form, so this doesn't need to survive a restart or be shared
// across instances. Mirrors the damper in /api/auth/login/route.ts, but keyed
// per-IP (that route is single-admin-desk and uses one shared counter; a
// kiosk tablet is a fixed, known source and per-IP keeps a neighbour's typos
// from locking the tablet out).
const attempts = new Map<string, Attempt>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** Hash-then-compare rather than a direct ===: not for secrecy (the PIN
 *  round-trips through the request body anyway) but so a wrong guess can't be
 *  timed by how many leading digits matched. */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rec = attempts.get(ip) ?? { failures: 0, lockedUntil: 0 };

  if (Date.now() < rec.lockedUntil) {
    return NextResponse.json(
      { error: "Too many attempts — locked out", lockedUntil: rec.lockedUntil },
      { status: 429 },
    );
  }

  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  // Config-over-env: a PIN saved on the settings page's System card wins
  // over KIOSK_PIN; "0000" is the last-resort default when neither is set.
  const expected = systemSetting("kioskPin", "KIOSK_PIN") || "0000";
  const ok = typeof pin === "string" && pin.length > 0 && safeEqual(pin, expected);

  if (!ok) {
    rec.failures++;
    if (rec.failures >= MAX_FAILURES) {
      rec.lockedUntil = Date.now() + LOCKOUT_MS;
      rec.failures = 0;
    }
    attempts.set(ip, rec);
    return NextResponse.json(
      {
        error: "Incorrect PIN",
        lockedUntil: rec.lockedUntil > Date.now() ? rec.lockedUntil : undefined,
      },
      { status: 401 },
    );
  }

  attempts.delete(ip);
  const expiresAt = Date.now() + KIOSK_ELEVATION_TTL_SECONDS * 1000;
  const res = NextResponse.json({ ok: true, expiresAt });
  res.cookies.set(KIOSK_ELEVATION_COOKIE, await createKioskElevationToken(), kioskElevationCookieOptions());
  return res;
}
