// Brute-force damper shared by login and the Settings password check:
// lockout after `threshold` failures in a row, for `lockMs`.
export function createAttemptLimiter(opts: { threshold?: number; lockMs?: number; now?: () => number } = {}) {
  const { threshold = 5, lockMs = 60_000, now = Date.now } = opts;
  let failures = 0;
  let lockedUntil = 0;
  return {
    isLocked: () => now() < lockedUntil,
    fail() {
      failures++;
      if (failures >= threshold) {
        lockedUntil = now() + lockMs;
        failures = 0;
      }
    },
    reset() {
      failures = 0;
    },
  };
}
