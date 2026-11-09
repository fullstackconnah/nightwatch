const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Stored timers come from localStorage: keep only entries the strip and chime can safely read. */
export function validTimers<T>(parsed: unknown[]): T[] {
  return parsed.filter(
    (t) =>
      typeof t === "object" && t !== null &&
      typeof (t as Record<string, unknown>).id === "string" && (t as Record<string, string>).id !== "" &&
      typeof (t as Record<string, unknown>).name === "string" &&
      num((t as Record<string, unknown>).endsAt) && num((t as Record<string, unknown>).durationMs) &&
      ((t as Record<string, unknown>).pausedRemainingMs === null || num((t as Record<string, unknown>).pausedRemainingMs)),
  ) as T[];
}
