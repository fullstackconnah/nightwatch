/* The glance route's decision order as a pure function, so node:test can load it: off -> 503,
 * bad bearer -> 401 (and `build` is never called), build throws -> 502, else 200. Relative imports only. */
import { bearerMatches } from "./bearer.ts";
import { deskAccess } from "./desk-auth.ts";

export async function deskGlanceResponse<T>(a: {
  deskToken: string | undefined;
  mcpToken: string | undefined;
  authorization: string | null;
  build: () => Promise<T>;
}): Promise<{ status: 200 | 401 | 502 | 503; body: T | { error: string } }> {
  if (deskAccess(a.deskToken, a.mcpToken) === "off") return { status: 503, body: { error: "Desk access is not turned on." } };
  if (!bearerMatches(a.authorization, a.deskToken)) return { status: 401, body: { error: "unauthorized" } };
  try {
    return { status: 200, body: await a.build() };
  } catch {
    // Never 503: the desk app reads that as "Desk access is off" and clears its glance. Only an authorised caller gets here.
    return { status: 502, body: { error: "Attention report unavailable." } };
  }
}
