import { withTimeout } from "./single-flight.ts";

/** Marks "no answer in time" so the control can tell it from a failure the write itself reported. */
export class WriteTimeout extends Error {}

/** 120000 -> "2 min", 90000 -> "90 s", 30 -> "30 ms". */
export function formatLimit(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`;
}

/** Runs the write; rejects with a WriteTimeout when it has not answered after `ms` (0 = no limit). A late result is ignored. */
export async function runWithLimit(run: () => Promise<void>, ms: number): Promise<void> {
  if (ms <= 0) return run();
  const gave = Symbol();
  if ((await withTimeout(run(), ms, () => gave)) === gave) throw new WriteTimeout(`no answer after ${formatLimit(ms)}`);
}
