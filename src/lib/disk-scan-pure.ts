// shortcut: dev and ino as numbers, exact below 2^53; switch to { bigint: true } if a filesystem here ever exceeds that
export function fileIdentity(st: { dev: number; ino: number }): string {
  return `${st.dev}:${st.ino}`;
}

/** Returns a filter that is true only the first time it sees an identity, so
 *  hardlinks to one file count once (the first path met stays). */
export function newIdentityFilter(): (identity: string) => boolean {
  const seen = new Set<string>();
  return (identity) => {
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  };
}
