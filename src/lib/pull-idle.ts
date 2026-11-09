// Import-free leaf (node:test cannot resolve "@/"). Idle guard for a Docker image-pull progress stream.

export const PULL_IDLE_MS = 60_000;
export const PULL_STALLED_MESSAGE = "Image pull stalled: no progress for 60s";

/** Destroys `stream` and calls `onIdle` when no data arrives for `idleMs`. Returns a stop function. */
export function guardPullIdle(
  stream: { on(event: "data", cb: () => void): unknown; destroy(): void },
  idleMs: number,
  onIdle: (err: Error) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stream.destroy();
      onIdle(new Error(PULL_STALLED_MESSAGE));
    }, idleMs);
  };
  stream.on("data", arm);
  arm();
  return () => clearTimeout(timer);
}
