/**
 * Server-only password-hash resolution — deliberately NOT in auth.ts.
 * auth.ts is imported by client components (cookie names, session helpers)
 * and by the EDGE middleware, so it must never touch node:fs; loadConfig
 * does. Only the login and password-change API routes need these, and both
 * are Node.js route handlers. (Observed live 2026-08-02: putting loadConfig
 * in auth.ts pulled node:fs into the client bundle and broke `next build`.)
 *
 * Precedence: like every other operational setting (systemSetting() in
 * config.ts) the stored hash wins; env ADMIN_PASSWORD_HASH counts only while
 * none is stored. Recovery from a forgotten password: remove
 * system.adminPasswordHash from the stored config file (README).
 */

import { loadConfig } from "@/lib/config";
import { choosePasswordHashes, type PasswordHashCandidate } from "@/lib/password-hash";

export type { PasswordHashCandidate };

/** The one bcrypt hash a submitted password is checked against (none, or one). */
export function candidatePasswordHashes(): PasswordHashCandidate[] {
  return choosePasswordHashes(loadConfig().system?.adminPasswordHash, process.env.ADMIN_PASSWORD_HASH);
}

/** True once either source has a hash set — the "password set" vs
 *  "login disabled outside dev" status on settings and login. */
export function isPasswordConfigured(): boolean {
  return candidatePasswordHashes().length > 0;
}
