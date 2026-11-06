/** Pure reply checks for client fetches, split out so the error branches are testable. */

/** The assistant route's own words are kept at any status; a blank or missing `say` is "couldn't reach". */
export function assistantSay(reply: { say?: unknown }): string {
  if (typeof reply.say !== "string" || !reply.say.trim()) throw new Error("bad assistant reply");
  return reply.say;
}

/** An error reply must never look like a new build: it would reload the kiosk. */
export function versionBuildId(ok: boolean, data: { buildId?: unknown }): string {
  if (!ok || typeof data.buildId !== "string") throw new Error("bad version reply");
  return data.buildId;
}

/** Login failure text: the server's own error when it sent one, else the generic line. */
export const loginFailure = (data: { error?: unknown }) => (typeof data.error === "string" && data.error) || "Login failed";
