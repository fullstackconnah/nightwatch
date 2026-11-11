/** Pure desk-widget access decisions (relative imports only, so node:test can load them). */

const MIN_DESK_TOKEN = 32;

/**
 * "off" when the desk token is missing, shorter than 32 characters, or equal to
 * the MCP token (one leaked token must not open both). Callers pass the values
 * of systemSetting(), read per request so a rotation is hot.
 */
export function deskAccess(deskToken: string | undefined, mcpToken: string | undefined): "off" | "on" {
  if (!deskToken || deskToken.length < MIN_DESK_TOKEN || deskToken === mcpToken) return "off";
  return "on";
}

/** Exact match, like the glance one: never widen this to a /api/desk/ prefix. */
export function isDeskCameraPath(pathname: string): boolean {
  return pathname === "/api/desk/camera";
}

/** Exact match: PUBLIC_PATHS matches by prefix, which would also open /api/desk/glance-anything. */
export function isDeskGlancePath(pathname: string): boolean {
  return pathname === "/api/desk/glance";
}
