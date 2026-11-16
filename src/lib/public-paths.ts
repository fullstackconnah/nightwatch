// Paths the middleware lets through with no session. Matched by whole segment, so a future
// /api/mcpfoo or /loginx is NOT public just because /api/mcp and /login are.
// The kiosk PWA files are listed one by one: they were only public because "/kiosk" was a bare prefix.
export const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/kiosk",
  "/api/auth/oidc",
  "/kiosk",
  "/api/mcp",
  "/dashboard.webmanifest",
  "/kiosk.webmanifest",
  "/kiosk-icon-180.png",
  "/kiosk-icon-192.png",
  "/kiosk-icon-512.png",
];

export const isPublicPath = (pathname: string): boolean =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
