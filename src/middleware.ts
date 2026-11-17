import { NextRequest, NextResponse } from "next/server";
import { crossSiteWriteRefused } from "@/lib/same-origin";
import { isDeskCameraPath, isDeskGlancePath } from "@/lib/desk-auth";
import { KIOSK_ELEVATION_COOKIE, SESSION_COOKIE, isRequestAuthenticated } from "@/lib/auth";
import { kioskPinConfigured, sessionEpoch } from "@/lib/config";
import { isPublicPath } from "@/lib/public-paths";

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
// paths. The list (matched by whole segment, kiosk manifest + icons named one
// by one) lives in lib/public-paths.ts.

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // The desktop widget's glance checks its own bearer token inside the route (GET only, no cookie to forge).
  if (isDeskGlancePath(pathname)) return NextResponse.next();
  // The camera frame checks the same bearer plus system.deskCamera inside its route (GET only).
  if (isDeskCameraPath(pathname)) return NextResponse.next();
  // Before the public-path return so login/kiosk/logout writes are covered too.
  // /api/mcp uses a bearer token, no cookie, so there is nothing to forge.
  if (pathname !== "/api/mcp" && !pathname.startsWith("/api/mcp/") && crossSiteWriteRefused(req.method, req.headers)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (isPublicPath(pathname)) return NextResponse.next();

  // A real session passes everywhere. A kiosk PIN elevation passes only the
  // API calls the elevated kiosk makes (container list/lifecycle, voice — see
  // lib/kiosk-access.ts); anything else it requests is refused like no login.
  const ok = await isRequestAuthenticated(
    req.cookies.get(SESSION_COOKIE)?.value,
    kioskPinConfigured() ? req.cookies.get(KIOSK_ELEVATION_COOKIE)?.value : undefined, // no PIN: an old elevation is dead
    req.method,
    pathname,
    sessionEpoch(),
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
  // Node runtime, not Edge: the session epoch is read from data/auth.json and its config.json mirror (node:fs).
  runtime: "nodejs",
  // Everything except static assets, and the Minecraft pack upload: Next 15.5
  // buffers (and truncates at 10 MB) the body of any matched path, but that
  // route streams ~300 MB zips. It authenticates itself (verifySessionToken in the route).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/minecraft/instances/upload$).*)"],
};
