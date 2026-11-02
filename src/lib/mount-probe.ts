/**
 * Pure classifier for the "mount is unreadable" attention probe. Import-free so
 * node:test can load it. Only the errors a dead or hung mount produces count;
 * ENOENT/EACCES etc. say nothing about drive health and stay silent.
 */
export const MOUNT_DEAD_CODES = ["EIO", "ENOTCONN", "ESTALE", "TIMEOUT"] as const;

export type MountVerdict = { headline: string; detail: string };

export function classifyMountError(mount: string, code: string | undefined): MountVerdict | null {
  if (!code || !(MOUNT_DEAD_CODES as readonly string[]).includes(code)) return null;
  return {
    headline: `Drive unreadable: ${mount}`,
    detail:
      code === "TIMEOUT"
        ? "It is not answering (timed out). It may have dropped off."
        : `Reads from it are failing (${code}). It may have dropped off and need a remount or a restart.`,
  };
}
