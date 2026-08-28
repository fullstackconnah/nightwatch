/* Pure schedule math + request validation for the kiosk's AC auto-off
 * nightly sweep. No React, no Node APIs — every function takes `now`
 * explicitly so the whole nightly lifecycle is unit-testable without a
 * clock. Local time throughout: the kiosk lives on a wall in this house,
 * and "23:00" means 23:00 on that wall, DST included (the local Date
 * constructor absorbs DST shifts). */

export interface ClimateAutoOffConfig {
  enabled: boolean;
  /** "HH:MM", 24h. */
  time: string;
  /** "YYYY-MM-DD" — skip the sweep whose window STARTS on this local date. */
  skipDate?: string;
  /** "YYYY-MM-DD" — a sweep already fired for this window date. */
  lastRunDate?: string;
}

export interface SweepWindow {
  /** Local date the window STARTS on — the sweep's identity, so a
   *  near-midnight schedule spilling past 00:00 still counts as one night. */
  dateKey: string;
  startMs: number;
  endMs: number;
}

export type AutoOffStatus =
  | { kind: "off" }
  | { kind: "scheduled"; window: SweepWindow }
  | { kind: "skipped"; window: SweepWindow }
  | { kind: "done" };

/** Catch-up window: a kiosk tab that was reloading at the scheduled minute
 *  still sweeps when it comes back, up to an hour late. Past that the night
 *  is missed by design (spec: no server daemon). */
export const SWEEP_WINDOW_MS = 60 * 60_000;
export const WARN_LEAD_MS = 5 * 60_000;
export const DEFAULT_AUTO_OFF_TIME = "23:00";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTime(time: string): { hour: number; minute: number } | null {
  if (!TIME_RE.test(time)) return null;
  const [h, m] = time.split(":");
  return { hour: Number(h), minute: Number(m) };
}

export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function windowStartingOn(now: Date, dayOffset: number, hour: number, minute: number): SweepWindow {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute);
  return { dateKey: localDateKey(start), startMs: start.getTime(), endMs: start.getTime() + SWEEP_WINDOW_MS };
}

/** The window containing `now`, if any. Checks today's start and
 *  yesterday's, because a window opened at 23:40 is still open at 00:20. */
export function activeWindow(now: Date, time: string): SweepWindow | null {
  const t = parseTime(time);
  if (!t) return null;
  for (const dayOffset of [0, -1]) {
    const w = windowStartingOn(now, dayOffset, t.hour, t.minute);
    if (now.getTime() >= w.startMs && now.getTime() < w.endMs) return w;
  }
  return null;
}

/** The next window whose start is at or after `now` (today or tomorrow). */
export function upcomingWindow(now: Date, time: string): SweepWindow | null {
  const t = parseTime(time);
  if (!t) return null;
  for (const dayOffset of [0, 1]) {
    const w = windowStartingOn(now, dayOffset, t.hour, t.minute);
    if (w.startMs >= now.getTime()) return w;
  }
  return null;
}

/** Non-null → the engine should fire the off-volley for this window now. */
export function shouldFire(cfg: ClimateAutoOffConfig, now: Date): SweepWindow | null {
  if (!cfg.enabled) return null;
  const w = activeWindow(now, cfg.time);
  if (!w) return null;
  if (w.dateKey === cfg.lastRunDate || w.dateKey === cfg.skipDate) return null;
  return w;
}

/** Non-null → the pre-sweep warning strip should be visible. */
export function warnWindow(cfg: ClimateAutoOffConfig, now: Date): SweepWindow | null {
  if (!cfg.enabled) return null;
  const w = upcomingWindow(now, cfg.time);
  if (!w) return null;
  if (w.dateKey === cfg.lastRunDate || w.dateKey === cfg.skipDate) return null;
  const ms = now.getTime();
  return ms >= w.startMs - WARN_LEAD_MS && ms < w.startMs ? w : null;
}

export function statusFor(cfg: ClimateAutoOffConfig, now: Date): AutoOffStatus {
  if (!cfg.enabled) return { kind: "off" };
  const active = activeWindow(now, cfg.time);
  if (active && cfg.lastRunDate === active.dateKey) return { kind: "done" };
  const target = active ?? upcomingWindow(now, cfg.time);
  if (!target) return { kind: "off" }; // unparseable time — treat as unconfigured
  if (cfg.skipDate === target.dateKey) return { kind: "skipped", window: target };
  return { kind: "scheduled", window: target };
}

/* ── POST body validation (shared with the public kiosk route) ──────────── */

export interface ClimateAutoOffPatch {
  enabled?: boolean;
  time?: string;
  /** null clears the skip ("resume tonight"). */
  skipDate?: string | null;
  lastRunDate?: string;
}

/** Same defense-in-depth discipline as /kiosk/api/ha/action's parseBody:
 *  this feeds an UNAUTHENTICATED route, so unknown keys are rejected and
 *  every field is shape-checked — a LAN device can flip this feature's own
 *  settings (same exposure class as flipping the AC itself) and nothing
 *  else. */
export function parseClimateAutoOffPatch(value: unknown): ClimateAutoOffPatch | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Request body must be a JSON object." };
  }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!["enabled", "time", "skipDate", "lastRunDate"].includes(key)) {
      return { error: `Unknown field "${key}".` };
    }
  }
  const patch: ClimateAutoOffPatch = {};
  if ("enabled" in v) {
    if (typeof v.enabled !== "boolean") return { error: "enabled must be a boolean." };
    patch.enabled = v.enabled;
  }
  if ("time" in v) {
    if (typeof v.time !== "string" || !TIME_RE.test(v.time)) return { error: "time must be HH:MM (24h)." };
    patch.time = v.time;
  }
  if ("skipDate" in v) {
    if (v.skipDate !== null && (typeof v.skipDate !== "string" || !DATE_RE.test(v.skipDate))) {
      return { error: "skipDate must be YYYY-MM-DD or null." };
    }
    patch.skipDate = v.skipDate as string | null;
  }
  if ("lastRunDate" in v) {
    if (typeof v.lastRunDate !== "string" || !DATE_RE.test(v.lastRunDate)) {
      return { error: "lastRunDate must be YYYY-MM-DD." };
    }
    patch.lastRunDate = v.lastRunDate;
  }
  if (Object.keys(patch).length === 0) return { error: "No recognized fields in request." };
  return patch;
}
