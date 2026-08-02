import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { candidatePasswordHashes } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

// Brute-force damper: 1s constant delay + lockout after repeated failures.
let failures = 0;
let lockedUntil = 0;

export async function POST(req: NextRequest) {
  if (Date.now() < lockedUntil) {
    return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  // Tries every configured hash (config.json's system.adminPasswordHash, then
  // env ADMIN_PASSWORD_HASH) and accepts a match against any of them — see
  // candidatePasswordHashes()'s own comment for why this checks both rather
  // than picking one by precedence: a broken config value must never lock
  // the owner out of a still-good env hash.
  const candidates = candidatePasswordHashes();

  let ok = false;
  if (candidates.length && password) {
    for (const candidate of candidates) {
      if (await bcrypt.compare(password, candidate.hash)) {
        ok = true;
        break;
      }
    }
  } else if (!candidates.length && process.env.NODE_ENV === "development") {
    ok = true; // dev only: no hash configured anywhere
  }

  await new Promise((r) => setTimeout(r, 1000));

  if (!ok) {
    failures++;
    if (failures >= 5) {
      lockedUntil = Date.now() + 60_000;
      failures = 0;
    }
    const reason = !candidates.length && process.env.NODE_ENV !== "development"
      ? "No admin password is configured — login disabled"
      : "Wrong password";
    return NextResponse.json({ error: reason }, { status: 401 });
  }

  failures = 0;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions());
  return res;
}
