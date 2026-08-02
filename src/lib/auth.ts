import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "hd_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Exported so src/lib/oidc.ts can sign/verify its own short-lived transient
// cookie (state/nonce/PKCE verifier) with the same secret/pattern as the
// session and kiosk-elevation tokens below — no behavior change here.
export function secretKey(): Uint8Array {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.ADMIN_PASSWORD_HASH || // fallback: sessions die if the password changes
    "homelab-dashboard-dev-secret";
  return new TextEncoder().encode(secret);
}

// The admin password-hash lookup lives in src/lib/auth-server.ts, NOT here:
// this module is imported by client components and the edge middleware, so
// it must never reach node:fs (loadConfig). See auth-server.ts for the
// try-both-hashes lockout-safety design.

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey());
    return true;
  } catch {
    return false;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false, // LAN + NPM-terminated TLS; cookie must survive plain-HTTP LAN access
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

// --- kiosk PIN elevation -----------------------------------------------------
//
// The /kiosk wall display is viewable without the normal admin session (see
// middleware.ts), but a short "Admin" tap can elevate it into the same
// authenticated surface the logged-in dashboard gets. That elevation is a
// second, distinct JWT — not the session token above — so it carries its own
// short TTL and its own claim, and losing it can never extend or touch a real
// admin session.

export const KIOSK_ELEVATION_COOKIE = "hd_kiosk_elevated";
export const KIOSK_ELEVATION_TTL_SECONDS = 5 * 60; // 5 minutes, slides on activity (see /api/auth/kiosk/refresh)

export async function createKioskElevationToken(): Promise<string> {
  return new SignJWT({ sub: "kiosk", kiosk: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${KIOSK_ELEVATION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyKioskElevationToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.kiosk === true;
  } catch {
    return false;
  }
}

export function kioskElevationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: KIOSK_ELEVATION_TTL_SECONDS,
  };
}

/**
 * The one check every protected route effectively runs (via middleware.ts):
 * a normal admin session OR a still-valid kiosk PIN elevation both count as
 * "authenticated". Kept as its own function rather than folded into
 * verifySessionToken so the normal login flow's own check never changes
 * shape — this is strictly additive.
 */
export async function isRequestAuthenticated(
  sessionToken: string | undefined,
  kioskElevationToken: string | undefined,
): Promise<boolean> {
  if (await verifySessionToken(sessionToken)) return true;
  return verifyKioskElevationToken(kioskElevationToken);
}
