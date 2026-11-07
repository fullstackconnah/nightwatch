import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSessionToken, isMissingSecretError, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { candidatePasswordHashes } from "@/lib/auth-server";
import { createAttemptLimiter } from "@/lib/attempt-limiter";

export const dynamic = "force-dynamic";

// Brute-force damper: 1s constant delay + lockout after repeated failures.
const limiter = createAttemptLimiter();

export async function POST(req: NextRequest) {
  const { password } = ((await req.json().catch(() => null)) ?? {}) as { password?: string };
  if (!limiter.attempt()) {
    return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 });
  }
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
    const reason = !candidates.length && process.env.NODE_ENV !== "development"
      ? "No admin password is configured — login disabled"
      : "Wrong password";
    return NextResponse.json({ error: reason }, { status: 401 });
  }

  limiter.reset();
  const res = NextResponse.json({ ok: true });
  try {
    res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions());
  } catch (e) {
    if (!isMissingSecretError(e)) throw e;
    return NextResponse.json({ error: "SESSION_SECRET is not set — login disabled" }, { status: 503 });
  }
  return res;
}
