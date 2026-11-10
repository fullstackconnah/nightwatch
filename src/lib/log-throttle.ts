// Per-key throttle for errors logged from a 1 Hz loop: one stack per key per
// minute instead of one per second while a cause persists.
const WINDOW_MS = 60_000;
const state = new Map<string, { at: number; suppressed: number; failures: number }>();

export function throttledError(key: string, err: unknown): void {
  const now = Date.now();
  const s = state.get(key);
  if (s) {
    s.failures++;
    if (now - s.at < WINDOW_MS) {
      s.suppressed++;
      return;
    }
  }
  const note = s?.suppressed ? ` (${s.suppressed} similar suppressed)` : "";
  console.error(`[telemetry] ${key} failed${note}:`, err);
  if (s) Object.assign(s, { at: now, suppressed: 0 });
  else state.set(key, { at: now, suppressed: 0, failures: 1 });
}

export function recovered(key: string): void {
  const s = state.get(key);
  if (!s) return;
  state.delete(key);
  console.info(`[telemetry] ${key} recovered after ${s.failures} failures`);
}
