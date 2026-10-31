import { SignJWT, jwtVerify } from "jose";
import { kioskMayCall } from "./kiosk-access.ts";

export const SESSION_COOKIE = "hd_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Every token carries a `typ` (session | kiosk | oidc-flow) and its verifier requires it: all three share
// this secret, so without it one kind could be replayed as another.
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
  return new SignJWT({ sub: "admin", typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.typ === "session" && payload.sub === "admin";
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
  return new SignJWT({ sub: "kiosk", kiosk: true, typ: "kiosk" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${KIOSK_ELEVATION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyKioskElevationToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.typ === "kiosk" && payload.kiosk === true;
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
 * a normal admin session passes everywhere; a still-valid kiosk PIN elevation
 * passes only the few API calls the elevated kiosk makes (kiosk-access.ts).
 * Kept as its own function rather than folded into verifySessionToken so the
 * normal login flow's own check never changes shape.
 */
export async function isRequestAuthenticated(
  sessionToken: string | undefined,
  kioskElevationToken: string | undefined,
  method: string,
  pathname: string,
): Promise<boolean> {
  if (await verifySessionToken(sessionToken)) return true;
  return kioskMayCall(method, pathname) && (await verifyKioskElevationToken(kioskElevationToken));
}

// --- OIDC transient flow token ------------------------------------------------
export const OIDC_FLOW_TTL_SECONDS = 5 * 60; // 5 minutes

export interface OidcFlowClaims {
  state: string;
  nonce: string;
  verifier: string;
}

export async function createOidcFlowToken(claims: OidcFlowClaims): Promise<string> {
  return new SignJWT({ ...claims, typ: "oidc-flow" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OIDC_FLOW_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyOidcFlowToken(token: string | undefined): Promise<OidcFlowClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.typ !== "oidc-flow") return null;
    if (typeof payload.state !== "string" || typeof payload.nonce !== "string" || typeof payload.verifier !== "string") {
      return null;
    }
    return { state: payload.state, nonce: payload.nonce, verifier: payload.verifier };
  } catch {
    return null;
  }
}
