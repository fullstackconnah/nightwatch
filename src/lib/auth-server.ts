/**
 * Server-only password-hash resolution — deliberately NOT in auth.ts.
 * auth.ts is imported by client components (cookie names, session helpers)
 * and by the EDGE middleware, so it must never touch node:fs; loadConfig
 * does. Only the login and password-change API routes need these, and both
 * are Node.js route handlers. (Observed live 2026-08-02: putting loadConfig
 * in auth.ts pulled node:fs into the client bundle and broke `next build`.)
 *
 * Precedence: once data/auth.json carries v 2 its adminPasswordHash is the
 * stored hash and the config's is ignored (a config copied over the server's
 * cannot bring a password back); before that the config's stored hash wins.
 * Env ADMIN_PASSWORD_HASH counts only while none is stored. Recovery from a
 * forgotten password: remove adminPasswordHash from data/auth.json (README).
 */

import { loadAuthState, loadConfig } from "@/lib/config";
import { choosePasswordHashes, storedHashFor, type PasswordHashCandidate } from "@/lib/password-hash";

export type { PasswordHashCandidate };

/** The one bcrypt hash a submitted password is checked against (none, or one). */
export function candidatePasswordHashes(): PasswordHashCandidate[] {
  return choosePasswordHashes(storedHashFor(loadAuthState(), loadConfig().system?.adminPasswordHash), process.env.ADMIN_PASSWORD_HASH);
}

/** True once either source has a hash set — the "password set" vs
 *  "login disabled outside dev" status on settings and login. */
export function isPasswordConfigured(): boolean {
  return candidatePasswordHashes().length > 0;
}
