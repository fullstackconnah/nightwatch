import { systemSetting } from "@/lib/config";
import { bearerMatches } from "@/lib/bearer";

/**
 * Bearer-token auth for /api/mcp, entirely separate from the cookie-session
 * auth the rest of the app uses (src/lib/auth.ts) — MCP clients are not
 * browsers and never hold the `hd_session` cookie.
 *
 * The token is config-over-env via systemSetting("mcpToken", "MCP_TOKEN"): a
 * value saved on the settings page's System card wins over MCP_TOKEN, which
 * remains the fallback for installs that provision it via compose only. The
 * server is opt-in either way: no value from config or env means "feature
 * not turned on", not "open". The route handler is expected to check
 * mcpEnabled() first and return 503 before ever calling isAuthorized().
 */

export function mcpEnabled(): boolean {
  return !!systemSetting("mcpToken", "MCP_TOKEN");
}

/** Constant-time bearer-token check (see bearerMatches); false for a disabled server. */
export function isAuthorized(authorizationHeader: string | null): boolean {
  return bearerMatches(authorizationHeader, systemSetting("mcpToken", "MCP_TOKEN"));
}
