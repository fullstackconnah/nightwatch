/**
 * Per-container cache for `GET /containers/{id}/json` results.
 *
 * Start/finish times and exit code only change when the container's state
 * changes, so an unchanged id is not re-inspected. An id is inspected when it is
 * new, when its list `state`, `created` or `status` text differs from the cached entry, or when
 * the entry is older than ttlMs. Ids missing from the list are dropped, so the
 * cache cannot grow. A failed inspect is omitted and nothing is cached for it.
 *
 * shortcut: a restart that leaves the list `status` string unchanged (e.g. two
 * restarts inside one "Up 4 seconds" window) is seen up to ttlMs late; the TTL bounds it.
 */
export interface InspectKey {
  id: string;
  state: string;
  created: number;
  status: string; // "Up 3 days": a restart resets the uptime text, so it shows up at once
}

/** Rows that still have live stats: Docker's old `listContainers({ all: false })` set. */
export const hasLiveStats = (state: string) => state === "running" || state === "paused" || state === "restarting";

interface Entry<T> {
  state: string;
  status: string;
  created: number;
  at: number;
  value: T;
}

export function createInspectCache<T>(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, Entry<T>>();
  let generation = 0; // clear() bumps it so a resolve already in flight cannot store a pre-clear value
  return {
    async resolve(keys: InspectKey[], inspect: (id: string) => Promise<T>): Promise<Record<string, T>> {
      const live = new Set(keys.map((k) => k.id));
      for (const id of entries.keys()) if (!live.has(id)) entries.delete(id);
      const t = now();
      const gen = generation;
      const out: Record<string, T> = {};
      await Promise.all(
        keys.map(async (k) => {
          const hit = entries.get(k.id);
          if (hit && hit.state === k.state && hit.created === k.created && hit.status === k.status && t - hit.at <= ttlMs) {
            out[k.id] = hit.value;
            return;
          }
          try {
            const value = await inspect(k.id);
            if (gen === generation) entries.set(k.id, { state: k.state, status: k.status, created: k.created, at: t, value });
            out[k.id] = value;
          } catch {
            // Removed between the list and the inspect, or a transient error: stale entry must not outlive it.
            entries.delete(k.id);
          }
        }),
      );
      return out;
    },
    clear: () => {
      generation++;
      entries.clear();
    },
  };
}
