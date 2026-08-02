import { NextRequest, NextResponse } from "next/server";
import {
  OIDC_FLOW_COOKIE,
  clearedOidcFlowCookieOptions,
  exchangeCode,
  oidcConfig,
  verifyIdToken,
  verifyOidcFlowToken,
} from "@/lib/oidc";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";

/** Browser-facing origin. req.nextUrl.origin reflects the server's BIND
 *  address (0.0.0.0:3005 inside the container), not what the user typed —
 *  which broke the OIDC redirect_uri exact-match check (observed live
 *  2026-08-02). The Host header carries the address the browser actually
 *  used; protocol honors x-forwarded-proto when a proxy fronts us. */
function requestOrigin(req: NextRequest): string {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}


export const dynamic = "force-dynamic";

/** Every failure path lands here: 302 to /login?sso_error=<code>, with the
 *  transient flow cookie always cleared (single-use, cleared on callback
 *  regardless of outcome — see src/lib/oidc.ts). The raw error never reaches
 *  the URL, only one of the four codes the login page knows how to render. */
function ssoErrorRedirect(req: NextRequest, code: "denied" | "exchange_failed" | "verify_failed" | "config") {
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  login.searchParams.set("sso_error", code);
  const res = NextResponse.redirect(login);
  res.cookies.set(OIDC_FLOW_COOKIE, "", clearedOidcFlowCookieOptions());
  return res;
}

export async function GET(req: NextRequest) {
  if (!oidcConfig()) {
    return ssoErrorRedirect(req, "config");
  }

  const { searchParams } = req.nextUrl;

  // Authelia redirects back with ?error=... on user cancel / access_denied /
  // any authorization-stage refusal, without ever hitting the token endpoint.
  if (searchParams.get("error")) {
    return ssoErrorRedirect(req, "denied");
  }

  const flow = await verifyOidcFlowToken(req.cookies.get(OIDC_FLOW_COOKIE)?.value);
  const state = searchParams.get("state");
  const code = searchParams.get("code");

  // Missing/expired/tampered flow cookie, no code, or a state that doesn't
  // match what /api/auth/oidc/login stashed — all collapse to "denied": none
  // of these represent a completed, trustworthy consent from Authelia.
  if (!flow || !code || !state || state !== flow.state) {
    return ssoErrorRedirect(req, "denied");
  }

  const redirectUri = `${requestOrigin(req)}/api/auth/oidc/callback`;

  let idToken: string;
  try {
    const tokens = await exchangeCode(code, redirectUri, flow.verifier);
    idToken = tokens.id_token;
  } catch {
    return ssoErrorRedirect(req, "exchange_failed");
  }

  try {
    await verifyIdToken(idToken, flow.nonce);
  } catch {
    return ssoErrorRedirect(req, "verify_failed");
  }

  // Same session helper the password login mints from — no forked session
  // logic, no id_token/access_token ever set on any client-visible cookie.
  // Post-login destination is always "/", never a caller-supplied path.
  const res = NextResponse.redirect(new URL("/", requestOrigin(req)));
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions());
  res.cookies.set(OIDC_FLOW_COOKIE, "", clearedOidcFlowCookieOptions());
  return res;
}
