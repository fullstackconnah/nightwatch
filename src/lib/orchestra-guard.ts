import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./auth.ts";
import { fullSessionAllowed } from "./require-full-session.ts";

/** Returns a 403 JSON response (never 401: client.ts treats 401 as the browser's own session expiry), or null to proceed. */
export async function requireFullSession(req: NextRequest): Promise<NextResponse | null> {
  if (await fullSessionAllowed(req.cookies.get(SESSION_COOKIE)?.value)) return null;
  return NextResponse.json({ error: "A full admin session is required." }, { status: 403 });
}
