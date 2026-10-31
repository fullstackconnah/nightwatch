const MIN_GAP_MS = 5_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_PER_DAY = 200;

/** Start times of allowed asks within the last 24 h, oldest first. */
let starts: number[] = [];

/**
 * Process-wide limit on kiosk asks (each one starts a Hermes job). Not per
 * client: the only identity available is a forwarded header the caller controls
 * (same reasoning as kiosk-lockout.ts). One ask per 5 s, 200 per rolling 24 h.
 * In-memory, lost on restart. Refused asks are not recorded.
 */
export function allowAsk(nowMs: number = Date.now()): { ok: true } | { ok: false; reason: "rate" | "daily" } {
  while (starts.length && nowMs - starts[0] >= DAY_MS) starts.shift();
  if (starts.length >= MAX_PER_DAY) return { ok: false, reason: "daily" };
  if (starts.length && nowMs - starts[starts.length - 1] < MIN_GAP_MS) return { ok: false, reason: "rate" };
  starts.push(nowMs);
  return { ok: true };
}

export function reset() {
  starts = [];
}
