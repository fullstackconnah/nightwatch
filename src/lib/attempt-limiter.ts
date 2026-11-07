// Brute-force damper shared by login and the Settings password check:
// attempt() counts each try up front, so parallel guesses cannot all pass a
// check made before the slow part; 'threshold' tries lock it for 'lockMs'.
// The counter is global on purpose: this LAN host has no trustworthy client identity, and a per-IP key could be spoofed for unlimited guesses.
export function createAttemptLimiter(opts: { threshold?: number; lockMs?: number; now?: () => number } = {}) {
  const { threshold = 5, lockMs = 60_000, now = Date.now } = opts;
  let count = 0;
  let lockedUntil = 0;
  return {
    /** Synchronous. False while locked. The 'threshold'-th try is still let through and starts the lock; reset() on a correct password clears it, so only wrong guesses leave one. */
    attempt() {
      if (now() < lockedUntil) return false;
      if (++count >= threshold) {
        lockedUntil = now() + lockMs;
        count = 0;
      }
      return true;
    },
    reset() {
      count = 0;
      lockedUntil = 0;
    },
  };
}
