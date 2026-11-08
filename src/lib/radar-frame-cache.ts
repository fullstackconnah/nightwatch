/* Small TTL + size-capped cache for radar PNGs, keyed on the validated upstream path. Pure, clock injectable, so node:test can load it. */

export const RADAR_CACHE_MAX = 60;
export const RADAR_CACHE_TTL_MS = 10 * 60 * 1000;

export type RadarFrameCache = {
  get(key: string): ArrayBuffer | null;
  /** Callers pass only successful PNG bodies; errors are never stored. */
  set(key: string, body: ArrayBuffer): void;
  /** A failed upstream answer: `missed` is true for 60 s so a repeated stamp does not refetch. */
  markMiss(key: string): void;
  missed(key: string): boolean;
};

export const RADAR_MISS_TTL_MS = 60 * 1000;

export function createRadarFrameCache(now: () => number = Date.now, max = RADAR_CACHE_MAX, ttlMs = RADAR_CACHE_TTL_MS): RadarFrameCache {
  const map = new Map<string, { body: ArrayBuffer; at: number }>(); // insertion order = oldest first
  const misses = new Map<string, number>(); // key -> time of miss, oldest first, capped like the cache
  return {
    markMiss(key) {
      misses.delete(key);
      misses.set(key, now());
      while (misses.size > max) misses.delete(misses.keys().next().value as string);
    },
    missed(key) {
      const at = misses.get(key);
      if (at === undefined) return false;
      if (now() - at >= RADAR_MISS_TTL_MS) {
        misses.delete(key);
        return false;
      }
      return true;
    },
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (now() - hit.at >= ttlMs) {
        map.delete(key);
        return null;
      }
      return hit.body;
    },
    set(key, body) {
      map.delete(key);
      map.set(key, { body, at: now() });
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
  };
}
