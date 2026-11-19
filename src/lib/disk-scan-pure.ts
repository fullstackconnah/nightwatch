// shortcut: dev and ino as numbers, exact below 2^53; switch to { bigint: true } if a filesystem here ever exceeds that
// null when nlink <= 1 (or 0/missing, as some FUSE mounts report): such a file cannot be a hardlink, and
// those mounts can reuse one dev:ino for different files, so it must never be dropped as a repeat.
export function fileIdentity(st: { dev: number; ino: number; nlink: number }): string | null {
  return st.nlink > 1 ? `${st.dev}:${st.ino}` : null;
}

/** Returns a filter that is true only the first time it sees an identity, so
 *  hardlinks to one file count once (the first path met stays). A null identity is always first. */
export function newIdentityFilter(): (identity: string | null) => boolean {
  const seen = new Set<string>();
  return (identity) => {
    if (identity === null) return true;
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
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`cannot read ${rootAbs}: ${msg.split(hostPath).join(rootAbs)}`); // Node's errno text quotes the host path
  }
}
