const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Stored timers come from localStorage: keep only entries the strip and chime can safely read. */
export function validTimers<T>(parsed: unknown[]): T[] {
  return parsed.filter(
    (t) =>
      typeof t === "object" && t !== null &&
      num((t as Record<string, unknown>).endsAt) && num((t as Record<string, unknown>).durationMs) &&
      ((t as Record<string, unknown>).pausedRemainingMs === null || num((t as Record<string, unknown>).pausedRemainingMs)),
  ) as T[];
}
