import { SignJWT, jwtVerify } from "jose";
import { loadConfig } from "@/lib/config";

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

// --- admin password: config-over-env, but tried BOTH ways -------------------
//
// Every other operational setting (see systemSetting() in src/lib/config.ts)
// uses strict config-wins-over-env precedence: one effective value, config
// if present else env. The admin password hash is deliberately NOT built on
// that same helper, because a single wrong pick here is the one failure mode
// that can lock the owner out entirely — a corrupted/mistyped config.json
// hash must never shadow a still-good env hash. So login (and the
// change-password flow's "verify current password" step) try EVERY
// available hash and accept a match against any of them, config first.

export interface PasswordHashCandidate {
  hash: string;
  source: "config" | "env";
}

/** Every bcrypt hash a submitted password should be checked against, config
 *  first then env, filtered to only the ones actually set. Callers iterate
 *  and accept on the first match — see the module comment above for why
 *  this tries both instead of picking one by precedence. */
export function candidatePasswordHashes(): PasswordHashCandidate[] {
  const candidates: PasswordHashCandidate[] = [];
  const configHash = loadConfig().system?.adminPasswordHash?.trim();
  if (configHash) candidates.push({ hash: configHash, source: "config" });
  const envHash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (envHash) candidates.push({ hash: envHash, source: "env" });
  return candidates;
}

/** True once either source has a hash set — used for the "password set" vs
 *  "login disabled outside dev" status the settings page and login form
 *  both show. */
export function isPasswordConfigured(): boolean {
  return candidatePasswordHashes().length > 0;
}

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
