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
