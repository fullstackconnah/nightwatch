/* Which admin password hash signs in (alias-free so node:test can load it). */
export interface PasswordHashCandidate {
  hash: string;
  source: "config" | "env";
}

/** The stored hash (Settings) wins; the env hash counts only while none is stored (first setup).
 *  Never both, so a password changed in Settings retires the one in the compose file. */
export function choosePasswordHashes(stored: string | undefined, env: string | undefined): PasswordHashCandidate[] {
  const hash = stored?.trim();
  if (hash) return [{ hash, source: "config" }];
  const envHash = env?.trim();
  return envHash ? [{ hash: envHash, source: "env" }] : [];
}
