import { NextRequest, NextResponse } from "next/server";
import { KIOSK_ELEVATION_COOKIE, SESSION_COOKIE, isRequestAuthenticated } from "@/lib/auth";

// /kiosk (and its own /kiosk/api/* vitals+counts endpoints) is deliberately
// public on the LAN — it's an ambient wall display that exposes only host
// vitals and container health counts, never logs or secrets. /api/auth/kiosk
// (PIN submit + its refresh/lock siblings) must also be reachable from that
// unauthenticated surface, the same way /api/auth/login is exempted for /login.
// /api/mcp carries its own Bearer-token auth (MCP clients never hold the
// session cookie); the route 503s outright when MCP_TOKEN is unset.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/kiosk", "/kiosk", "/api/mcp"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // A valid kiosk PIN elevation counts as authenticated too, so the existing
  // authenticated docker API routes (start/stop/restart) work unchanged from
  // an elevated kiosk without weakening what they accept from anyone else.
  const ok = await isRequestAuthenticated(
    req.cookies.get(SESSION_COOKIE)?.value,
    req.cookies.get(KIOSK_ELEVATION_COOKIE)?.value,
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
