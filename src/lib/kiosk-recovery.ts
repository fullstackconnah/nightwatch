export const RESET_DELAY_MS = 10_000;
export const MAX_AUTO_ATTEMPTS = 3;
export const WINDOW_MS = 5 * 60 * 1000;

export type RecoveryState = { attempts: number[]; escalatedAt: number | null };
export type Phase = "retrying" | "escalating" | "stuck";

// Sliding window: an attempt only counts if it happened in the last WINDOW_MS.
// Stuck waits out the window, then one reload starts a fresh ladder.
export function planRecovery(
  state: RecoveryState,
  now: number,
): { phase: Phase; delayMs: number; recentAttempts: number[] } {
  const recentAttempts = state.attempts.filter((t) => now - t < WINDOW_MS);
  if (recentAttempts.length < MAX_AUTO_ATTEMPTS) {
    return { phase: "retrying", delayMs: RESET_DELAY_MS, recentAttempts };
  }
  if (state.escalatedAt === null || now - state.escalatedAt >= WINDOW_MS) {
    return { phase: "escalating", delayMs: RESET_DELAY_MS, recentAttempts };
  }
  const untilWindowEnds = state.escalatedAt + WINDOW_MS - now + 1000;
  return { phase: "stuck", delayMs: Math.max(RESET_DELAY_MS, untilWindowEnds), recentAttempts };
}
