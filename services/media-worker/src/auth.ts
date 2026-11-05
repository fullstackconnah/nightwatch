import { timingSafeEqual } from "node:crypto";

export const MIN_TOKEN_LENGTH = 32;

/** Constant-time bearer check. A wrong-length token is false without calling timingSafeEqual (which throws on unequal lengths). */
export function bearerOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  if (!m) return false;
  const got = Buffer.from(m[1]);
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}
