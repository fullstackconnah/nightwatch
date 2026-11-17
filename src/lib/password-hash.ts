/* Which admin password hash signs in (alias-free so node:test can load it). */
export interface PasswordHashCandidate {
  hash: string;
  source: "config" | "env";
}

/** The stored hash, from the auth file once it carries v 2 (then the config hash is ignored: a config copied
 *  over the server's cannot bring a password back), else the config hash as before. A blank v 2 hash means none. */
export function storedHashFor(auth: Record<string, unknown>, configHash: string | undefined): string | undefined {
  if (auth.v !== 2) return configHash;
  return typeof auth.adminPasswordHash === "string" ? auth.adminPasswordHash.trim() || undefined : undefined;
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
      // damaged hash: treat as no match; the line carries no hash, error text or password
      console.warn("[auth] a stored password hash could not be compared");
    }
  }
  return false;
}
