const MAX_FAILURES = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;

/**
 * One global record for kiosk PIN attempts. Not per-IP: the only client
 * identity available is a forwarded header the caller controls, so keying on it
 * lets an attacker rotate it for unlimited guesses. The kiosk is a single wall
 * tablet, so a shared counter costs nothing. Each lockout doubles the last
 * (30 s → 15 min cap); a correct PIN resets it. In-memory, lost on restart.
 */
export function createKioskLockout(now: () => number = Date.now) {
  let failures = 0;
  let lockouts = 0;
  let until = 0;

  return {
    /** Epoch ms the lock lasts until, or 0 when not locked. */
    lockedUntil: () => (now() < until ? until : 0),
    /** Record a wrong PIN; returns the new lockedUntil, or 0 if not locked. */
    fail(): number {
      if (++failures >= MAX_FAILURES) {
        failures = 0;
        until = now() + Math.min(BASE_LOCKOUT_MS * 2 ** lockouts, MAX_LOCKOUT_MS);
        lockouts++;
      }
      return this.lockedUntil();
    },
    /** Whole decision, synchronous: lock check, compare, then fail/reset with no await between. */
    attempt(pinOk: () => boolean): { status: 200 | 401 | 429; lockedUntil: number } {
      const locked = this.lockedUntil();
      if (locked) return { status: 429, lockedUntil: locked };
      if (pinOk()) {
        this.reset();
        return { status: 200, lockedUntil: 0 };
      }
      return { status: 401, lockedUntil: this.fail() };
    },
    reset() {
      failures = lockouts = until = 0;
    },
  };
}
