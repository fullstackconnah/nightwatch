// Brute-force damper shared by login and the Settings password check:
// attempt() counts each try up front, so parallel guesses cannot all pass a
// check made before the slow part; 'threshold' tries lock it for 'lockMs'.
export function createAttemptLimiter(opts: { threshold?: number; lockMs?: number; now?: () => number } = {}) {
  const { threshold = 5, lockMs = 60_000, now = Date.now } = opts;
  let count = 0;
  let lockedUntil = 0;
  return {
    /** Synchronous. False when locked; otherwise counts the attempt, locking once it reaches the threshold. */
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
    },
  };
}
