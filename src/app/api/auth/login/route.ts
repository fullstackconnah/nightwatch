import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Brute-force damper: 1s constant delay + lockout after repeated failures.
let failures = 0;
let lockedUntil = 0;

export async function POST(req: NextRequest) {
  if (Date.now() < lockedUntil) {
    return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const hash = process.env.ADMIN_PASSWORD_HASH;

  let ok = false;
  if (hash && password) {
    ok = await bcrypt.compare(password, hash);
  } else if (!hash && process.env.NODE_ENV === "development") {
    ok = true; // dev only: no hash configured
  }

  await new Promise((r) => setTimeout(r, 1000));

  if (!ok) {
    failures++;
    if (failures >= 5) {
      lockedUntil = Date.now() + 60_000;
      failures = 0;
    }
    const reason = !hash && process.env.NODE_ENV !== "development"
      ? "ADMIN_PASSWORD_HASH is not set — login disabled"
      : "Wrong password";
    return NextResponse.json({ error: reason }, { status: 401 });
  }

  failures = 0;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions());
  return res;
}
