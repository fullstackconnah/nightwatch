/**
 * One Minecraft job at a time (restore, backup run, activate, server start). The manager
 * lives outside this repo, so the dashboard refuses overlap itself. Stop and restart are
 * never guarded. State is on globalThis so every route bundle shares one flag.
 */
export type McJob = "restore" | "run" | "activate" | "start" | "install" | "upload" | "delete";

/** Actions that can start the minecraft container: a restart of a stopped container starts it. Stop is never guarded. */
export const isGuardedAction = (action: string) => action === "start" || action === "restart";

export const guardsMinecraftStart = (action: string, name: string | undefined) =>
  isGuardedAction(action) && name === "minecraft";

const g = globalThis as unknown as { __mcBusy?: { kind: McJob; token: object } | null };

/** A release function, or null when another job holds the guard. Call release in `finally`. */
export function tryBegin(kind: McJob): (() => void) | null {
  if (g.__mcBusy) return null;
  const mine = { kind, token: {} };
  g.__mcBusy = mine;
  return () => {
    if (g.__mcBusy === mine) g.__mcBusy = null;
  };
}

export const isBusy = () => !!g.__mcBusy;

export const busyMessage = () =>
  `Another Minecraft job is running (${g.__mcBusy?.kind ?? "unknown"}). Try again when it finishes.`;

/** The manager's own compose timeout is 1800 s, so a job that outlived our fetch can run this long. */
export const TIMEOUT_GRACE_MS = 30 * 60_000;

/**
 * Release after a manager timeout: the manager keeps working, so hold the guard until the grace ends.
 * shortcut: per-process memory, so the hold is lost on a redeploy; the real fix is a manager lock plus a status route.
 */
export function holdAfterTimeout(release: () => void): void {
  setTimeout(release, TIMEOUT_GRACE_MS).unref?.();
}
