/**
 * Options for the one-shot (follow: false) scrollback read. Pure and import-free so node:test can load it.
 * The deadline is per call, never client-wide: follow streams are quiet for long stretches and get no signal.
 */
export function oneShotLogOptions(tail: number, sinceMs: number | undefined, tailMax: number, deadlineMs: number) {
  return {
    stdout: true,
    stderr: true,
    timestamps: true,
    follow: false as const,
    ...(sinceMs === undefined ? { tail } : { since: Math.floor(sinceMs / 1000), tail: tailMax }),
    abortSignal: AbortSignal.timeout(deadlineMs),
  };
}
