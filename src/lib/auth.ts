import { SignJWT, jwtVerify } from "jose";
import { kioskMayCall } from "./kiosk-access.ts";

export const SESSION_COOKIE = "hd_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Every token carries a `typ` (session | kiosk | oidc-flow) and its verifier requires it: all three share
// this secret, so without it one kind could be replayed as another.
// Exported so src/lib/oidc.ts can sign/verify its own short-lived transient
// cookie (state/nonce/PKCE verifier) with the same secret/pattern as the
// session and kiosk-elevation tokens below — no behavior change here.
export function secretKey(): Uint8Array<ArrayBuffer> {
  const secret = process.env.SESSION_SECRET; // never the password hash: anyone who saw the hash could mint a session
  if (secret) return new TextEncoder().encode(secret);
  // The literal below is public; production must never sign with it. The verify functions catch this and fail closed.
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode("homelab-dashboard-dev-secret");
}

// Only the missing-secret throw above maps to a 503 in the login routes; any other error is a real fault.
export const isMissingSecretError = (e: unknown): boolean => e instanceof Error && e.message.includes("SESSION_SECRET");

// The admin password-hash lookup lives in src/lib/auth-server.ts, NOT here:
// this module is imported by client components and the edge middleware, so
// it must never reach node:fs (loadConfig). See auth-server.ts for the
// try-both-hashes lockout-safety design.

// `ep` is the session epoch stored in config (bumped by a password change); epoch is required so tsc flags every caller.
export async function createSessionToken(epoch: number): Promise<string> {
  return new SignJWT({ sub: "admin", typ: "session", ep: epoch })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

// ep >= epoch, not ===: a rolled-back config (epoch 0) must never lock the owner out. A missing ep counts as 0.
export async function verifySessionToken(token: string | undefined, epoch: number): Promise<boolean> {
  if (!token || !Number.isSafeInteger(epoch)) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const ep = payload.ep === undefined ? 0 : payload.ep;
    return payload.typ === "session" && payload.sub === "admin" && typeof ep === "number" && Number.isSafeInteger(ep) && ep >= 0 && ep >= epoch;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure, // only when the request came over https, so plain-HTTP LAN access keeps working
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

/**
 * A short keyed tag of the effective kiosk PIN, carried by the elevation token (`pt`) so changing the PIN locks
 * kiosks unlocked with the old one. HMAC under the token-signing secret: the JWT is only signed, so a bare hash of a
 * short PIN could be guessed offline by anyone holding the cookie. Empty for no PIN (or no usable secret): verify refuses "".
 */
export async function kioskPinTag(pin: string | undefined): Promise<string> {
  if (!pin) return "";
  try {
    const key = await crypto.subtle.importKey("raw", secretKey(), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("kiosk-pin:" + pin));
    return Array.from(new Uint8Array(mac).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

// Carries the session epoch like createSessionToken, so a password change locks a PIN-unlocked kiosk; `pinTag` (kioskPinTag) does the same for a PIN change.
export async function createKioskElevationToken(epoch: number, pinTag: string): Promise<string> {
  return new SignJWT({ sub: "kiosk", kiosk: true, typ: "kiosk", ep: epoch, pt: pinTag })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${KIOSK_ELEVATION_TTL_SECONDS}s`)
    .sign(secretKey());
}

// ep >= epoch, a missing ep counts as 0 (same rule as verifySessionToken).
// A token with no `pt` claim (minted before PIN binding), or one that differs from the current PIN's tag, is refused.
export async function verifyKioskElevationToken(token: string | undefined, epoch: number, pinTag: string): Promise<boolean> {
  if (!token || !pinTag || !Number.isSafeInteger(epoch)) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const ep = payload.ep === undefined ? 0 : payload.ep;
    return payload.typ === "kiosk" && payload.kiosk === true && payload.pt === pinTag && typeof ep === "number" && Number.isSafeInteger(ep) && ep >= 0 && ep >= epoch;
  } catch {
    return false;
  }
}

export function kioskElevationCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
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
  epoch: number,
  kioskPinTag: string,
): Promise<boolean> {
  if (await verifySessionToken(sessionToken, epoch)) return true;
  return kioskMayCall(method, pathname) && (await verifyKioskElevationToken(kioskElevationToken, epoch, kioskPinTag));
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
