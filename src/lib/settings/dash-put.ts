import type { AppConfig } from "../config.ts";

type Kind = "array" | "object";
const FIELDS: Record<"groups" | "urls" | "icons" | "hidden" | "widgets", Kind> = {
  groups: "array", urls: "object", icons: "object", hidden: "array", widgets: "array",
};

/**
 * K12: PUT /api/settings carries only the fields one save edits (`{ widgets }` or `{ groups, urls, icons, hidden }`).
 * Fields the body lacks keep the stored value, and every other block (hermes, jellyfin, ...) is never touched.
 * A body with none of the five fields, or one of the wrong shape, is refused so a bad client can't blank the config.
 */
export function mergeDashPut(current: AppConfig, body: unknown): { next: AppConfig } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const present = (Object.keys(FIELDS) as (keyof typeof FIELDS)[]).filter((k) => b[k] !== undefined);
  if (!present.length) return { error: "nothing to save" };
  for (const k of present) {
    const v = b[k];
    const good = FIELDS[k] === "array" ? Array.isArray(v) : v !== null && typeof v === "object" && !Array.isArray(v);
    if (!good) return { error: `${k} must be ${FIELDS[k] === "array" ? "an array" : "an object"}` };
  }
  return { next: { ...current, ...Object.fromEntries(present.map((k) => [k, b[k]])) } as AppConfig };
}
