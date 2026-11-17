/* Step-up: the current password, asked again before Settings changes a way back in (alias-free so node:test can load it). */
import { createAttemptLimiter } from "./attempt-limiter.ts";
import { matchesAny } from "./password-hash.ts";

/** The route's own computed values (secrets already trimmed), never the raw body, so the two cannot drift. */
export interface StepUpChange {
  generateMcpToken?: boolean;
  clearMcpToken?: boolean;
  typedMcpToken?: string;
  clearKioskPin?: boolean;
  typedKioskPin?: string;
  clearOidcClientSecret?: boolean;
  typedOidcClientSecret?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
}

/** An absent value is no change; undefined and the empty string are equal. */
const changed = (next: string | undefined, stored: string | undefined) => next !== undefined && next !== (stored ?? "");

/** True when the save changes a sign-in or token setting. A typed secret counts even when equal to the stored one,
 *  or a stolen session could test PIN guesses without the kiosk lockout. */
export function stepUpNeeded(change: StepUpChange, existing: { oidcIssuer?: string; oidcClientId?: string }): boolean {
  return (
    change.generateMcpToken === true ||
    change.clearMcpToken === true ||
    Boolean(change.typedMcpToken) ||
    change.clearKioskPin === true ||
    Boolean(change.typedKioskPin) ||
    change.clearOidcClientSecret === true ||
    Boolean(change.typedOidcClientSecret) ||
    changed(change.oidcIssuer, existing.oidcIssuer) ||
    changed(change.oidcClientId, existing.oidcClientId)
  );
}

// On globalThis so every route bundle shares one counter (the minecraft-busy.ts pattern).
const g = globalThis as unknown as { __nwStepUpLimiter?: ReturnType<typeof createAttemptLimiter> };
/** One brute-force damper for the password route and the system route. Login keeps its own. */
export const currentPasswordLimiter = (g.__nwStepUpLimiter ??= createAttemptLimiter());

export interface StepUpDeps {
  limiter: { attempt(): boolean; reset(): void };
  compare: (password: string, hash: string) => Promise<boolean>;
  wait?: () => Promise<unknown>;
}

/** Tags only: the route owns the status codes and copy. Only a request that reaches the compare uses up an attempt. */
export async function checkCurrentPassword(
  password: string,
  hashes: string[],
  { limiter, compare, wait = () => new Promise((r) => setTimeout(r, 1000)) }: StepUpDeps,
): Promise<"none" | "missing" | "limited" | "wrong" | "ok"> {
  if (!hashes.length) return "none";
  if (!password) return "missing";
  // No await sits between attempt() and the compare, so parallel guesses cannot all pass.
  if (!limiter.attempt()) return "limited";
  if (!(await matchesAny(password, hashes, compare))) {
    await wait();
    return "wrong";
  }
  limiter.reset();
  return "ok";
}
