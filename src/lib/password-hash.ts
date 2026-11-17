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

/** True when `password` matches any hash. A hash that cannot be compared (compare throws or rejects,
 *  e.g. a damaged stored value) counts as "does not match", so login answers 401 instead of 500. */
export async function matchesAny(
  password: string,
  hashes: string[],
  compare: (password: string, hash: string) => Promise<boolean>,
): Promise<boolean> {
  for (const hash of hashes) {
    try {
      if (await compare(password, hash)) return true;
    } catch {
      // damaged hash: treat as no match
    }
  }
  return false;
}
