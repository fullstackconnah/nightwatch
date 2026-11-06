// Docker 23+ labels every anonymous volume with this.
export const ANONYMOUS_LABEL = "com.docker.volume.anonymous";

/** Orphan = anonymous and mounted by no container, running or stopped. Named
 *  unused volumes may hold a stopped stack's data, so they are never orphans. */
export function isOrphanVolume(
  v: { Name: string; Labels?: Record<string, string> | null },
  usedNames: ReadonlySet<string>,
): boolean {
  return !!v.Labels && ANONYMOUS_LABEL in v.Labels && !usedNames.has(v.Name);
}

/** Removes exactly `names`, one by one. Docker refuses an in-use volume (409),
 *  and a volume that vanished (404) is already gone; both count as skipped. */
export async function removeVolumes(
  names: readonly string[],
  remove: (name: string) => Promise<void>,
): Promise<{ removed: string[]; skipped: string[] }> {
  const removed: string[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    try {
      await remove(name);
      removed.push(name);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status !== 409 && status !== 404) throw e;
      skipped.push(name);
    }
  }
  return { removed, skipped };
}

/** Names of volumes mounted by any container, running or stopped. */
export function usedVolumeNames(
  containers: readonly { Mounts?: readonly { Type?: string; Name?: string }[] }[],
): Set<string> {
  const used = new Set<string>();
  for (const c of containers) {
    for (const m of c.Mounts || []) {
      if (m.Type === "volume" && m.Name) used.add(m.Name);
    }
  }
  return used;
}
