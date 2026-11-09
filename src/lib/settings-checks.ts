// Pure input checks for the settings routes. Each returns an error message or null.
// Relative imports only, so node:test can load this file.

export const MCP_TOKEN_MIN = 24;
export const MAX_PINS = 50;
export const MAX_PIN_PATH = 4096;
export const MAX_RCON_HOST = 253;
export const MAX_BUDGET_USD = 1000;

/**
 * Blank is allowed (it means "clear" or "keep"); anything else must be an http(s) URL.
 * Every caller joins a path onto the saved URL (or sends a secret to it), so a login, ?query or #fragment is refused too.
 */
export function httpUrlError(field: string, value: string | undefined): string | null {
  if (!value) return null;
  if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) return `${field} must be an http(s) URL`;
  const u = new URL(value);
  return u.username || u.password || u.search || u.hash
    ? `${field} must be a plain http(s) address, with no login, ?query or #fragment.`
    : null;
}

const DISCORD_ID = /^\d{17,20}$/;
// No leading "-", space, "=" or newline: the Hermes daemon may pass this to a CLI argument or env file.
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/;

export function discordChannelIdError(v: string | undefined): string | null {
  return !v || DISCORD_ID.test(v) ? null : "Channel ID must be a Discord ID: 17 to 20 digits.";
}

export function discordUserIdsError(ids: string[]): string | null {
  return ids.every((x) => DISCORD_ID.test(x)) ? null : "Each allowed user ID must be a Discord ID: 17 to 20 digits.";
}

export function modelNameError(label: string, v: string | undefined): string | null {
  return !v || MODEL_NAME.test(v) ? null : `${label} must be a model name, such as claude-sonnet-5-5.`;
}

/** Only a typed token is checked; blank, Generate and "unchanged" never reach this. */
export function mcpTokenError(typed: string | undefined): string | null {
  return typed && typed.length < MCP_TOKEN_MIN ? `MCP token must be at least ${MCP_TOKEN_MIN} characters` : null;
}

/** `undefined` (key absent or blank in the UI) keeps the stored port. */
export function rconPortError(v: unknown): string | null {
  if (v === undefined) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535 ? null : "rconPort must be an integer 1-65535";
}

export function rconHostError(v: string | undefined): string | null {
  return v && v.length > MAX_RCON_HOST ? `rconHost must be at most ${MAX_RCON_HOST} characters` : null;
}

export function budgetError(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return "pipelineDailyBudgetUsd must be a non-negative number";
  return v > MAX_BUDGET_USD ? `pipelineDailyBudgetUsd must be at most ${MAX_BUDGET_USD}` : null;
}

/** The cap applies to a changed value only, so a budget stored above it before the cap existed doesn't block other saves. */
export function budgetChangeError(v: unknown, stored: number | undefined): string | null {
  return typeof v === "number" && v === stored && v >= 0 ? null : budgetError(v);
}

export function webhookError(v: string | undefined): string | null {
  if (!v) return null;
  return URL.canParse(v) && new URL(v).protocol === "https:" ? null : "discordWebhookUrl must be an https URL";
}

/** Add or remove one pin. `norm` is the route's path normaliser; a stored pin matches by its normalised form. */
export function applyPin(
  current: string[],
  action: "pin" | "unpin",
  path: string,
  norm: (p: string) => string | null,
): { pins: string[] } | { error: string } {
  const key = (p: string) => norm(p) ?? p;
  if (action === "unpin") return { pins: current.filter((p) => key(p) !== path) };
  if (current.some((p) => key(p) === path)) return { pins: current };
  if (new Set(current.map(key)).size >= MAX_PINS) return { error: `At most ${MAX_PINS} pins` };
  return { pins: [...current, path] };
}
