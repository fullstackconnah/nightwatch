/* Sunroom ambient and data (Sill DS PR 4): the small pure pieces the ambient components share. */

export type MeterTone = "ok" | "warn" | "bad";

/** The vitals fill's tone: warn and bad at the caller's thresholds (the same ones charts.tsx Meter colours by). */
export function meterTone(percent: number, warnAt: number, badAt: number): MeterTone {
  const p = Math.max(0, Math.min(100, percent));
  return p >= badAt ? "bad" : p >= warnAt ? "warn" : "ok";
}

/** The word beside a meter above its warn line (rule 5: a status colour never stands alone). */
export function meterWord(tone: MeterTone): string {
  return tone === "bad" ? "Critical" : tone === "warn" ? "High" : "";
}

/** The carousel pill's translateX: the dots are 44 px (hit-min) buttons with no gap, the pill rides dot i. */
export function dotsPillX(index: number): number {
  return Math.max(0, Math.round(index)) * 44;
}
