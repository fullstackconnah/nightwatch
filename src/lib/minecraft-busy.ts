/**
 * One Minecraft job at a time (restore, backup run, activate, server start). The manager
 * lives outside this repo, so the dashboard refuses overlap itself. Stop and restart are
 * never guarded. State is on globalThis so every route bundle shares one flag.
 */
export type McJob = "restore" | "run" | "activate" | "start";

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

export const busyMessage = () =>
  `Another Minecraft job is running (${g.__mcBusy?.kind ?? "unknown"}). Try again when it finishes.`;
