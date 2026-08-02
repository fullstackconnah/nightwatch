import { createHash, randomBytes } from "node:crypto";
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { secretKey } from "@/lib/auth";
import { systemSetting } from "@/lib/config";

// --- OIDC single sign-on (Authelia) -----------------------------------------
//
// Hand-rolled authorization-code + PKCE flow on top of jose + fetch — no new
// dependency. Every piece of server config comes from three optional
// config-over-env values (see oidcConfig() — config.json's system.oidcIssuer/
// oidcClientId/oidcClientSecret win over OIDC_ISSUER/OIDC_CLIENT_ID/
// OIDC_CLIENT_SECRET, which remain the fallback); when any is absent the
// whole feature stays invisible: GET /api/auth/oidc/login 404s and the login
// page renders unchanged.
//
// Flow: /api/auth/oidc/login builds an authorization URL (buildAuthorizationUrl),
// stashes {state, nonce, verifier} in a short-lived signed cookie, and 302s to
// Authelia. /api/auth/oidc/callback validates state against that cookie,
// exchanges the code (exchangeCode), verifies the id_token (verifyIdToken —
// incl. nonce), then mints the same session cookie password login uses.

const HTTP_TIMEOUT_MS = 5_000;
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000; // ~1h

export class OidcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

export interface OidcConfig {
  issuer: string; // normalized, no trailing slash
  clientId: string;
  clientSecret: string;
}

/** The single feature gate: all three env vars present, or the feature does
 *  not exist. Never throws — callers use this to decide whether to expose
 *  any OIDC surface at all (404 the routes, hide the login button). */
export function oidcConfig(): OidcConfig | null {
  const issuer = systemSetting("oidcIssuer", "OIDC_ISSUER");
  const clientId = systemSetting("oidcClientId", "OIDC_CLIENT_ID");
  const clientSecret = systemSetting("oidcClientSecret", "OIDC_CLIENT_SECRET");
  if (!issuer || !clientId || !clientSecret) return null;
  return { issuer: issuer.replace(/\/+$/, ""), clientId, clientSecret };
}

/** Host only (e.g. "192.168.1.70:9091") for the settings panel — never the
 *  client secret, never the full issuer URL with any embedded credentials. */
export function oidcIssuerHost(): string | null {
  const cfg = oidcConfig();
  if (!cfg) return null;
  try {
    return new URL(cfg.issuer).host;
  } catch {
    return null;
  }
}

// --- discovery, cached in module scope --------------------------------------

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface DiscoveryCacheEntry {
  issuer: string;
  doc: DiscoveryDocument;
  fetchedAt: number;
}

let discoveryCache: DiscoveryCacheEntry | null = null;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function discover(issuer: string): Promise<DiscoveryDocument> {
  if (discoveryCache && discoveryCache.issuer === issuer && Date.now() - discoveryCache.fetchedAt < DISCOVERY_CACHE_TTL_MS) {
    return discoveryCache.doc;
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${issuer}/.well-known/openid-configuration`);
  } catch (err) {
    throw new OidcError("discovery_failed", err instanceof Error ? err.message : "discovery request failed");
  }
  if (!res.ok) {
    throw new OidcError("discovery_failed", `discovery endpoint returned ${res.status}`);
  }

  let doc: DiscoveryDocument;
  try {
    doc = (await res.json()) as DiscoveryDocument;
  } catch {
    throw new OidcError("discovery_failed", "discovery response was not valid JSON");
  }
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri || !doc.issuer) {
    throw new OidcError("discovery_failed", "discovery document missing required fields");
  }
  if (doc.issuer !== issuer) {
    // RFC-recommended check: the discovery document's own issuer claim must
    // exactly match what we requested, or something is misconfigured/spoofed.
    throw new OidcError("discovery_failed", "discovery document issuer mismatch");
  }

  discoveryCache = { issuer, doc, fetchedAt: Date.now() };
  return doc;
}

// --- JWKS, also cached in module scope (createRemoteJWKSet keeps its own
// internal key cache/cooldown, but we still avoid rebuilding it per request) --

let jwksCache: { uri: string; jwks: JWTVerifyGetKey } | null = null;

function getJwks(jwksUri: string): JWTVerifyGetKey {
  if (jwksCache && jwksCache.uri === jwksUri) return jwksCache.jwks;
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  jwksCache = { uri: jwksUri, jwks };
  return jwks;
}

// --- PKCE + authorization URL -----------------------------------------------

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest().toString("base64url");
}

export async function buildAuthorizationUrl(redirectUri: string): Promise<AuthorizationRequest> {
  const cfg = oidcConfig();
  if (!cfg) throw new OidcError("config", "OIDC is not configured");

  const doc = await discover(cfg.issuer);

  const state = randomToken(24);
  const nonce = randomToken(24);
  const codeVerifier = randomToken(32); // 32 bytes -> 43-char base64url, RFC 7636 minimum length

  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", pkceChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  return { url: url.toString(), state, nonce, codeVerifier };
}

// --- token exchange -----------------------------------------------------------

export interface TokenResponse {
  id_token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export async function exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> {
  const cfg = oidcConfig();
  if (!cfg) throw new OidcError("config", "OIDC is not configured");

  const doc = await discover(cfg.issuer);

  // client_secret_basic (RFC 6749 2.3.1): both id and secret are individually
  // form-urlencoded before being joined with ':' and base64-encoded.
  const basic = Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString(
    "base64",
  );

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  let res: Response;
  try {
    res = await fetchWithTimeout(doc.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new OidcError("exchange_failed", err instanceof Error ? err.message : "token request failed");
  }

  if (!res.ok) {
    throw new OidcError("exchange_failed", `token endpoint returned ${res.status}`);
  }

  let json: TokenResponse | null;
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    throw new OidcError("exchange_failed", "token response was not valid JSON");
  }
  if (!json?.id_token) {
    throw new OidcError("exchange_failed", "token response missing id_token");
  }
  return json;
}

// --- id_token verification -----------------------------------------------------

export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<JWTPayload> {
  const cfg = oidcConfig();
  if (!cfg) throw new OidcError("config", "OIDC is not configured");

  const doc = await discover(cfg.issuer);
  const jwks = getJwks(doc.jwks_uri);

  let payload: JWTPayload;
  try {
    // jwtVerify checks `exp` (and `iat`/`nbf` when present) automatically;
    // `issuer`/`audience` options add the iss/aud checks. Only nonce needs a
    // manual comparison below — jose has no built-in option for it.
    const result = await jwtVerify(idToken, jwks, {
      issuer: doc.issuer,
      audience: cfg.clientId,
    });
    payload = result.payload;
  } catch (err) {
    throw new OidcError("verify_failed", err instanceof Error ? err.message : "id_token verification failed");
  }

  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    throw new OidcError("verify_failed", "nonce mismatch");
  }

  return payload;
}

// --- transient flow cookie ---------------------------------------------------
//
// Carries {state, nonce, verifier} across the redirect to Authelia and back.
// Signed with the same HS256 secret/pattern as the real session cookie
// (src/lib/auth.ts) so the raw PKCE verifier is never stored unsigned — a
// tampered cookie fails verification outright rather than being trusted.

export const OIDC_FLOW_COOKIE = "hd_oidc_flow";
const OIDC_FLOW_TTL_SECONDS = 5 * 60; // 5 minutes

export interface OidcFlowClaims {
  state: string;
  nonce: string;
  verifier: string;
}

export async function createOidcFlowToken(claims: OidcFlowClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OIDC_FLOW_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyOidcFlowToken(token: string | undefined): Promise<OidcFlowClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.state !== "string" || typeof payload.nonce !== "string" || typeof payload.verifier !== "string") {
      return null;
    }
    return { state: payload.state, nonce: payload.nonce, verifier: payload.verifier };
  } catch {
    return null;
  }
}

export function oidcFlowCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false, // matches sessionCookieOptions()/kioskElevationCookieOptions(): LAN + NPM-terminated TLS
    path: "/",
    maxAge: OIDC_FLOW_TTL_SECONDS,
  };
}

/** Cleared on the callback regardless of outcome — single-use, never reused
 *  across two callback attempts. */
export function clearedOidcFlowCookieOptions() {
  return { path: "/", maxAge: 0 };
}
