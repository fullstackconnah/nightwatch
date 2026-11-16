/**
 * Per-container cache for `GET /containers/{id}/json` results.
 *
 * Start/finish times and exit code only change when the container's state
 * changes, so an unchanged id is not re-inspected. An id is inspected when it is
 * new, when its list `state` or `created` differs from the cached entry, or when
 * the entry is older than ttlMs. Ids missing from the list are dropped, so the
 * cache cannot grow. A failed inspect is omitted and nothing is cached for it.
 *
 * shortcut: restartCount can be up to ttlMs old for a container that restarts
 * without leaving "running" between two polls; accepted, the TTL bounds it.
 */
export interface InspectKey {
  id: string;
  state: string;
  created: number;
}

interface Entry<T> {
  state: string;
  created: number;
  at: number;
  value: T;
}

export function createInspectCache<T>(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, Entry<T>>();
  return {
    async resolve(keys: InspectKey[], inspect: (id: string) => Promise<T>): Promise<Record<string, T>> {
      const live = new Set(keys.map((k) => k.id));
      for (const id of entries.keys()) if (!live.has(id)) entries.delete(id);
      const t = now();
      const out: Record<string, T> = {};
      await Promise.all(
        keys.map(async (k) => {
          const hit = entries.get(k.id);
          if (hit && hit.state === k.state && hit.created === k.created && t - hit.at <= ttlMs) {
            out[k.id] = hit.value;
            return;
          }
          try {
            const value = await inspect(k.id);
            entries.set(k.id, { state: k.state, created: k.created, at: t, value });
            out[k.id] = value;
          } catch {
            // Removed between the list and the inspect, or a transient error: stale entry must not outlive it.
            entries.delete(k.id);
          }
        }),
      );
      return out;
    },
    clear: () => entries.clear(),
  };
}
