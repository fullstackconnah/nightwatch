import { NextRequest, NextResponse } from "next/server";
import { crossSiteWriteRefused } from "@/lib/same-origin";
import { KIOSK_ELEVATION_COOKIE, SESSION_COOKIE, isRequestAuthenticated } from "@/lib/auth";

// /kiosk (and its own /kiosk/api/* vitals+counts endpoints) is deliberately
// public on the LAN — it's an ambient wall display that exposes only host
// vitals and container health counts. Kiosk speech that matches no intent falls
// through to a Hermes `ask`, which can read nightwatch MCP resources (container
// logs included); Hermes is asked to block log reads for ask jobs (vault handover
// Projects/HermesAIOps/Handovers/2026-10-31-kiosk-ask-logs) and asks are rate limited.
// /api/auth/kiosk
// (PIN submit + its refresh/lock siblings) must also be reachable from that
// unauthenticated surface, the same way /api/auth/login is exempted for /login.
// /api/mcp carries its own Bearer-token auth (MCP clients never hold the
// session cookie); the route 503s outright when MCP_TOKEN is unset.
// /api/auth/oidc (login + callback) must be reachable pre-session the same
// way — that's the whole point of an SSO entry point on the login page.
// /dashboard.webmanifest: iOS fetches the PWA manifest without cookies when
// adding to the home screen, and it contains nothing but names/colors/icon
// paths. (The kiosk's manifest + icons need no entry — the "/kiosk" prefix
// happens to cover /kiosk.webmanifest and /kiosk-icon-*.png too.)
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/kiosk", "/api/auth/oidc", "/kiosk", "/api/mcp", "/dashboard.webmanifest"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Before the public-path return so login/kiosk/logout writes are covered too.
  // /api/mcp uses a bearer token, no cookie, so there is nothing to forge.
  if (pathname !== "/api/mcp" && !pathname.startsWith("/api/mcp/") && crossSiteWriteRefused(req.method, req.headers)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // A real session passes everywhere. A kiosk PIN elevation passes only the
  // API calls the elevated kiosk makes (container list/lifecycle, voice — see
  // lib/kiosk-access.ts); anything else it requests is refused like no login.
  const ok = await isRequestAuthenticated(
    req.cookies.get(SESSION_COOKIE)?.value,
    req.cookies.get(KIOSK_ELEVATION_COOKIE)?.value,
    req.method,
    pathname,
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
  // Everything except static assets, and the Minecraft pack upload: Next 15.5
  // buffers (and truncates at 10 MB) the body of any matched path, but that
  // route streams ~300 MB zips. It authenticates itself (lib/upload-auth.ts).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/minecraft/instances/upload$).*)"],
};
