/**
 * One cached answer for the latest key, with one shared in-flight load.
 * A different key loads at once; `ttlOf` sets how long each answer lives (a failure can be shorter than a good one).
 */
export function cachedByKey<T>(ttlOf: (v: T) => number, now: () => number = Date.now) {
  let hit: { key: string; at: number; ttl: number; data: T } | null = null;
  let flight: { key: string; p: Promise<T> } | null = null;
  return (key: string, load: () => Promise<T>): Promise<T> => {
    if (hit && hit.key === key && now() - hit.at < hit.ttl) return Promise.resolve(hit.data);
    if (flight && flight.key === key) return flight.p;
    const p = load().then((data) => {
      hit = { key, at: now(), ttl: ttlOf(data), data };
      return data;
    }).finally(() => {
      if (flight?.p === p) flight = null;
    });
    flight = { key, p };
    return p;
  };
}
