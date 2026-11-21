import { relativeTime } from "./format.ts";

const MIN_PLAUSIBLE = Date.UTC(2000, 0, 1);

/** "active 5m ago", or null when the service sent no usable time (missing, not a string/number, unparsable, before 2000). A future time reads "just now". */
export function laneActivityText(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = new Date(v).getTime();
  if (!(t >= MIN_PLAUSIBLE)) return null;
  return `active ${relativeTime(Math.min(t, Date.now()))}`;
}
