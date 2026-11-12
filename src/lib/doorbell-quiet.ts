import type { HaDoorbellSnapshot } from "./types/ha.ts";

/** A front-door motion or activity entity normally updates daily; 3 days survives a quiet weekend. */
export const QUIET_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * A hit when a configured door camera's motion or activity entities have all gone silent.
 * shortcut: dings and binary_sensors are ignored (a ding can be quiet for weeks, and HA rewrites a
 * binary_sensor's last_changed on every restart so a dead camera would look fresh), so a ding-only
 * or binary-only setup never alerts; widen only if a setup has no event or sensor entity.
 * Age comes from firedAt against `nowMs`, not ageSec, so tests can pin "now".
 */
export function doorbellQuiet(snapshot: HaDoorbellSnapshot, nowMs: number): { days: number | null } | null {
  if (snapshot.status !== "ok" || snapshot.cameras.length === 0) return null;
  const candidates = snapshot.triggers.filter((t) => t.kind !== "ding" && !t.entityId.startsWith("binary_sensor."));
  if (candidates.length === 0) return null;
  const fired = candidates.flatMap((t) => (t.firedAt ? [Date.parse(t.firedAt)] : [])).filter((n) => !Number.isNaN(n));
  if (fired.length === 0) return { days: null };
  const age = nowMs - Math.max(...fired);
  return age > QUIET_DAYS * DAY_MS ? { days: Math.floor(age / DAY_MS) } : null;
}
