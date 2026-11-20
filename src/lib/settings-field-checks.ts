// Pure field decisions for the settings forms (hunt 13). Relative imports only, so node:test can load this file.
import { MAX_BUDGET_USD, rconPortError } from "./settings-checks.ts";

export const RCON_PORT_COPY = "Port must be a whole number from 1 to 65535.";
export const BUDGET_HINT = `Blank keeps the current cap. It can't be removed; the most is $${MAX_BUDGET_USD}.`;

/** Blank keeps the stored port (no error). Anything else must be a whole number the server's rconPortError accepts. */
export function rconPortFieldError(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return /^\d+$/.test(t) && rconPortError(Number(t)) === null ? null : RCON_PORT_COPY;
}

/**
 * The group input shows what the user typed while the trimmed text still means
 * the stored group (so a trailing space survives a keystroke); otherwise the
 * stored value wins (the draft was reset or edited elsewhere).
 */
export function groupInputText(typed: string | undefined, stored: string): string {
  return typed !== undefined && typed.trim() === stored ? typed : stored;
}

export const MAX_APP_URL = 2048;

/** First App URL the tiles save must refuse (the message names the container), or null. Shared by the server's mergeDashPut and the Tiles card. */
export function appUrlError(urls: Record<string, unknown>, stored: Record<string, unknown> = {}): string | null {
  for (const [name, v] of Object.entries(urls)) {
    if (name in stored && v === stored[name]) continue; // unchanged: a stored bad value for a removed container must not block the save
    if (typeof v === "string" && v.length > MAX_APP_URL) return `The App URL for ${name} is too long (the most is ${MAX_APP_URL} characters)`;
    if (typeof v !== "string" || !/^https?:\/\/\S+$/i.test(v.trim())) return `The App URL for ${name} must start with http:// or https://`;
  }
  return null;
}
