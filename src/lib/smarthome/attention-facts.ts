// Relative imports with explicit .ts: node --test has no "@/" resolver.
import type { HaSensor, HaStatesResponse } from "../types/ha.ts";
import { BATTERY_BAD, countSensorsDown, lowBatteries } from "./sensor-facts.ts";
import { Memo } from "../cache.ts";

export interface SmartHomeFacts {
  /** Batteries at BATTERY_BAD or less, lowest first. */
  batteries: HaSensor[];
  down: number;
}
const NONE: SmartHomeFacts = { batteries: [], down: 0 };

/** Not-ok snapshots (not set up, unreachable, token refused) give nothing: the Smart home page already says so. */
export function smartHomeFacts(r: Pick<HaStatesResponse, "status" | "entities">): SmartHomeFacts {
  if (r.status !== "ok" || !r.entities) return NONE;
  const { sensors } = r.entities;
  return { batteries: lowBatteries(sensors, BATTERY_BAD), down: countSensorsDown(sensors) };
}

/** getHaStates() is not cached and the attention report runs every 30 s around the clock, so the verdict is held for a minute. A throw counts as nothing. */
export function cachedSmartHomeFacts(
  fetchStates: () => Promise<Pick<HaStatesResponse, "status" | "entities">>,
  opts: { key: string },
): () => Promise<SmartHomeFacts> {
  const memo = new Memo<SmartHomeFacts>({
    key: opts.key,
    ttlMs: 60_000,
    load: async () => {
      try {
        return smartHomeFacts(await fetchStates());
      } catch {
        return NONE;
      }
    },
  });
  return () => memo.get();
}
