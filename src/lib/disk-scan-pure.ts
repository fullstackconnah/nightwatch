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

/** Reads one folder of a scan walk. A failed read of the ROOT throws (a result of "nothing found" would read as clean);
 *  a failed read of a deeper folder returns null so the walk skips it. `rootAbs` is the path as typed, not the host path. */
export function readWalkDir<T>(
  read: (hostPath: string) => T[],
  hostPath: string,
  dirAbs: string,
  rootAbs: string,
): T[] | null {
  try {
    return read(hostPath);
  } catch (e) {
    if (dirAbs !== rootAbs) return null; // permission denied or vanished mid-walk
    throw new Error(`cannot read ${rootAbs}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
