/**
 * Server-only password-hash resolution — deliberately NOT in auth.ts.
 * auth.ts is imported by client components (cookie names, session helpers)
 * and by the EDGE middleware, so it must never touch node:fs; loadConfig
 * does. Only the login and password-change API routes need these, and both
 * are Node.js route handlers. (Observed live 2026-08-02: putting loadConfig
 * in auth.ts pulled node:fs into the client bundle and broke `next build`.)
 *
 * Precedence note: every other operational setting uses strict
 * config-wins-over-env (systemSetting() in config.ts). The admin password
 * hash deliberately does NOT — a corrupted config.json hash must never
 * shadow a still-good env hash, so callers try EVERY available hash and
 * accept a match against any of them, config first.
 */

import { loadConfig } from "@/lib/config";

export interface PasswordHashCandidate {
  hash: string;
  source: "config" | "env";
}

/** Every bcrypt hash a submitted password should be checked against, config
 *  first then env, filtered to only the ones actually set. */
export function candidatePasswordHashes(): PasswordHashCandidate[] {
  const candidates: PasswordHashCandidate[] = [];
  const configHash = loadConfig().system?.adminPasswordHash?.trim();
  if (configHash) candidates.push({ hash: configHash, source: "config" });
  const envHash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (envHash) candidates.push({ hash: envHash, source: "env" });
  return candidates;
}

/** True once either source has a hash set — the "password set" vs
 *  "login disabled outside dev" status on settings and login. */
export function isPasswordConfigured(): boolean {
  return candidatePasswordHashes().length > 0;
}
