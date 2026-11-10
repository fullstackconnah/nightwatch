import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

/**
 * Constant-time bearer-token check shared by /api/mcp and /api/desk/glance.
 * Returns false (never throws) for an empty token, a missing or malformed
 * header, or a mismatch. Length differences are folded away by comparing the
 * token against itself on that path, so a wrong-length guess costs the same
 * as a same-length one; `timingSafeEqual` throws on unequal-length inputs, so
 * it can't be called directly on attacker-controlled input.
 */
export function bearerMatches(authorizationHeader: string | null | undefined, token: string | undefined): boolean {
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
