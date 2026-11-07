/* Small TTL + size-capped cache for radar PNGs, keyed on the validated upstream path. Pure, clock injectable, so node:test can load it. */

export const RADAR_CACHE_MAX = 60;
export const RADAR_CACHE_TTL_MS = 10 * 60 * 1000;

export type RadarFrameCache = {
  get(key: string): ArrayBuffer | null;
  /** Callers pass only successful PNG bodies; errors are never stored. */
  set(key: string, body: ArrayBuffer): void;
};

export function createRadarFrameCache(now: () => number = Date.now, max = RADAR_CACHE_MAX, ttlMs = RADAR_CACHE_TTL_MS): RadarFrameCache {
  const map = new Map<string, { body: ArrayBuffer; at: number }>(); // insertion order = oldest first
  return {
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
