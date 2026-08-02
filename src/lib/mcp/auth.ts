import { timingSafeEqual } from "node:crypto";
import { systemSetting } from "@/lib/config";

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

const BEARER_PREFIX = "Bearer ";

export function mcpEnabled(): boolean {
  return !!systemSetting("mcpToken", "MCP_TOKEN");
}

/**
 * Constant-time bearer-token check. Returns false (never throws) for a
 * missing header, a malformed header, a mismatched token, or a disabled
 * server. Length differences are folded away by comparing the token against
 * itself on that path, so a mismatched-length guess costs the same time as
 * a same-length one — `timingSafeEqual` itself throws on unequal-length
 * inputs, so it can't be called directly on attacker-controlled input.
 */
export function isAuthorized(authorizationHeader: string | null): boolean {
  const token = systemSetting("mcpToken", "MCP_TOKEN");
  if (!token) return false;
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) return false;

  const provided = Buffer.from(authorizationHeader.slice(BEARER_PREFIX.length), "utf8");
  const expected = Buffer.from(token, "utf8");
  if (provided.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(provided, expected);
}
