import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSessionToken, isMissingSecretError, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { sessionEpoch } from "@/lib/config";
import { isSecureRequest } from "@/lib/oidc-origin";
import { candidatePasswordHashes } from "@/lib/auth-server";
import { matchesAny } from "@/lib/password-hash";
import { createAttemptLimiter } from "@/lib/attempt-limiter";

export const dynamic = "force-dynamic";

// Brute-force damper: 1s constant delay + lockout after repeated failures.
const limiter = createAttemptLimiter();

export async function POST(req: NextRequest) {
  const { password } = ((await req.json().catch(() => null)) ?? {}) as { password?: string };
  if (!limiter.attempt()) {
    return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 });
  }
  // One hash: config.json's system.adminPasswordHash when set, else env
  // ADMIN_PASSWORD_HASH (first setup) — see candidatePasswordHashes().
  const candidates = candidatePasswordHashes();

  let ok = false;
  if (candidates.length && typeof password === "string" && password) {
    ok = await matchesAny(password, candidates.map((c) => c.hash), bcrypt.compare);
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
    res.cookies.set(SESSION_COOKIE, await createSessionToken(sessionEpoch()),sessionCookieOptions(isSecureRequest(req)));
  } catch (e) {
    if (!isMissingSecretError(e)) throw e;
    return NextResponse.json({ error: "SESSION_SECRET is not set. Set SESSION_SECRET in .env (a long random string), then restart." }, { status: 503 });
  }
  return res;
}
