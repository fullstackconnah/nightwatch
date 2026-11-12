const DAY_MS = 86_400_000;

/**
 * Newest time any of `ids` turned ON in a Home Assistant history reply
 * (`/api/history/period/...?minimal_response`: one array per entity, oldest first, and only the
 * first entry of each array carries `entity_id`). ISO string, or null for anything absent,
 * older than 24 h or malformed. Never throws: a bad reply must only cost the "Last seen" line.
 */
export function lastSeenFromHistory(reply: unknown, ids: readonly string[], nowMs: number): string | null {
  if (!Array.isArray(reply)) return null;
  let best = NaN;
  for (const series of reply) {
    if (!Array.isArray(series)) continue;
    const id = (series[0] as { entity_id?: unknown } | null)?.entity_id;
    if (typeof id !== "string" || !ids.includes(id)) continue;
    for (const entry of series) {
      const { state, last_changed } = (entry ?? {}) as { state?: unknown; last_changed?: unknown };
      // event.* state IS the press instant; binary_sensor counts when it turned on.
      // shortcut: sensor.* timestamp triggers are out of scope, add them when one is configured.
      const src = id.startsWith("event.") ? state : state === "on" ? last_changed : null;
      if (typeof src !== "string") continue;
      const t = Date.parse(src);
      // strictly after the window start: an entry dated exactly there is a sensor already on, not a new event
      if (Number.isFinite(t) && t <= nowMs && t > nowMs - DAY_MS && !(t <= best)) best = t;
    }
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}
