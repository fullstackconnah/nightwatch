/* Who may sign in through SSO (alias-free so node:test can load it). The provider proves WHO signed in;
 * this list decides whether that account may own the dashboard. */
interface Claims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

/** The config key and env var the allow-list is read from; a test pins both against .env.example and the README. */
export const ALLOW_SETTING_KEY = "oidcAllowedUsers";
export const ALLOW_ENV_NAME = "OIDC_ALLOWED_USERS";

export const parseAllowList = (raw: string | undefined): string[] => (raw ?? "").split(/[\s,]+/).filter(Boolean);

/** The stored value wins only when it names someone; blank or separator-only falls back to the env value (never opens SSO). */
export const allowListSetting = (stored: unknown, env: string | undefined): string | undefined =>
  typeof stored === "string" && parseAllowList(stored).length ? stored : env?.trim() || undefined;

export function oidcLoginAllowed(claims: Claims, rawList: string | undefined): { allowed: boolean; open: boolean } {
  const list = parseAllowList(rawList);
  if (list.length === 0) return { allowed: true, open: true };
  const bySub = typeof claims.sub === "string" && list.includes(claims.sub);
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  const byEmail = claims.email_verified === true && email !== null && list.some((e) => e.toLowerCase() === email);
  return { allowed: bySub || byEmail, open: false };
}

let warnedOpen = false;
export function resetOidcAllowWarning() {
  warnedOpen = false;
}

/** The decision plus its log lines: one warning per process for an open list, one line per refusal (sub only, quoted and cut). */
export function oidcAllowDecision(
  claims: Claims,
  rawList: string | undefined,
  log: { warn(m: string): void; error(m: string): void } = console,
): boolean {
  const { allowed, open } = oidcLoginAllowed(claims, rawList);
  if (open && !warnedOpen) {
    warnedOpen = true;
    log.warn("OIDC: no sign-in allow-list is set; any account the provider authenticates gets an owner session");
  }
  if (!allowed) log.error(`OIDC login refused: sub ${JSON.stringify(String(claims.sub).slice(0, 80))} is not in the allow-list`);
  return allowed;
}
