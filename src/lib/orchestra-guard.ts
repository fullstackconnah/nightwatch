import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./auth.ts";

/** Returns a 403 JSON response (never 401: client.ts treats 401 as the browser's own session expiry), or null to proceed. */
export async function requireFullSession(req: NextRequest): Promise<NextResponse | null> {
  // Real admin session only (typ "session"): kiosk and oidc-flow tokens are refused.
  if (await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return null;
  return NextResponse.json({ error: "A full admin session is required." }, { status: 403 });
}
