import { NextRequest, NextResponse } from "next/server";
import { requestOrigin, ssoErrorUrl } from "@/lib/oidc-origin";
import { OIDC_FLOW_COOKIE, buildAuthorizationUrl, createOidcFlowToken, oidcConfig, oidcFlowCookieOptions } from "@/lib/oidc";


export const dynamic = "force-dynamic";

/** Starts the OIDC authorization-code + PKCE flow. Redirect URI is always
 *  derived from the incoming request's own origin, so this works unmodified
 *  on both the real dashboard (:3005) and a test stack (:3006). */
export async function GET(req: NextRequest) {
  if (!oidcConfig()) {
    // Feature doesn't exist unless all three env vars are set — 404, not a
    // redirect, so an unconfigured instance never even hints the route exists.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const redirectUri = `${requestOrigin(req)}/api/auth/oidc/callback`;

  try {
    const { url, state, nonce, codeVerifier } = await buildAuthorizationUrl(redirectUri);
    const res = NextResponse.redirect(url, { status: 302 });
    res.cookies.set(
      OIDC_FLOW_COOKIE,
      await createOidcFlowToken({ state, nonce, verifier: codeVerifier }),
      oidcFlowCookieOptions(),
    );
    return res;
  } catch {
    // Discovery failed (issuer unreachable, malformed document, etc). Every
    // failure here collapses to "config" — the raw error never reaches the URL.
    return NextResponse.redirect(ssoErrorUrl(req, "config"));
  }
}
