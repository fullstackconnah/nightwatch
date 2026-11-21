// Pure field decisions for the settings forms (hunt 13). Relative imports only, so node:test can load this file.
import { MAX_BUDGET_USD, rconPortError } from "./settings-checks.ts";

export const RCON_PORT_COPY = "Port must be a whole number from 1 to 65535.";
export const BUDGET_HINT = `Blank keeps the current cap. It can't be removed; the most is $${MAX_BUDGET_USD}.`;

/** The Hermes daily-budget box, matching the server's change-only cap (budgetChangeError): the stored value itself is never refused for being over the cap. Blank keeps the cap. */
export function budgetFieldError(text: string, stored: unknown): string | null {
  if (!text.trim()) return null;
  const n = Number(text);
  // plain decimals only: Number() also takes 0x10, 0b11 and 1e2
  if (!/^\d+(\.\d+)?$/.test(text.trim()) || !Number.isFinite(n)) return "Daily budget must be a non-negative number";
  if (typeof stored === "number" && Number.isFinite(stored) && n === stored) return null;
  return n > MAX_BUDGET_USD ? `Daily budget: the most is $${MAX_BUDGET_USD}` : null;
}

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

/** bcrypt hashes only the first 72 bytes, so a longer new password would silently lose its tail. */
export const MAX_PASSWORD_BYTES = 72;
export const isPasswordOverBytes = (s: string): boolean => new TextEncoder().encode(s).length > MAX_PASSWORD_BYTES;

export const MAX_APP_URL = 2048;

/** A link a tile may render: http or https only. */
export const WEB_URL = /^https?:\/\/\S+$/i;

/** Key of the first App URL a save must refuse, or null. */
export function appUrlOffender(urls: Record<string, unknown>, stored: Record<string, unknown> = {}): string | null {
  for (const [name, v] of Object.entries(urls)) {
    const old = stored[name];
    // unchanged (ignoring surrounding spaces: the browser trims drafts): a stored bad value for a removed container must not block the save
    if (name in stored && (v === old || (typeof v === "string" && typeof old === "string" && v.trim() === old.trim()))) continue;
    if (typeof v !== "string" || v.length > MAX_APP_URL || !WEB_URL.test(v.trim())) return name;
  }
  return null;
}

/** First App URL the tiles save must refuse (the message names the container), or null. Shared by the server's mergeDashPut and the Tiles card. */
export function appUrlError(urls: Record<string, unknown>, stored: Record<string, unknown> = {}): string | null {
  const name = appUrlOffender(urls, stored);
  if (name === null) return null;
  const v = urls[name];
  if (typeof v === "string" && v.length > MAX_APP_URL) return `The App URL for ${name} is too long (the most is ${MAX_APP_URL} characters)`;
  return `The App URL for ${name} must start with http:// or https://`;
}

/** Change-password messages. "Too short" and "don't match" wait for their own field's first blur; "too long" shows at once. A mismatch is held back while the new password has its own error. */
export function passwordFieldHints(s: { next: string; confirm: string; nextTouched: boolean; confirmTouched: boolean }): { tooShort: boolean; tooLong: boolean; mismatch: boolean } {
  const short = s.next.length > 0 && s.next.length < 8;
  const tooLong = isPasswordOverBytes(s.next);
  return {
    tooShort: short && s.nextTouched,
    tooLong,
    mismatch: s.confirmTouched && s.confirm.length > 0 && s.next !== s.confirm && s.next.length >= 8 && !tooLong,
  };
}
