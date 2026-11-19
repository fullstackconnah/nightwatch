import fs from "node:fs";

export const STATFS_DEADLINE_MS = 2_000;

// Targets whose statfs has not settled. A hung call pins one libuv thread, so never start a second.
export const pendingStatfsTargets = new Set<string>();

/** statfs off the main thread with a deadline; null on error, deadline or a still-hung earlier call. */
export async function statfsWithDeadline(
  target: string,
  { statfs = fs.promises.statfs, deadlineMs = STATFS_DEADLINE_MS }: { statfs?: typeof fs.promises.statfs; deadlineMs?: number } = {},
): Promise<fs.StatsFs | null> {
  if (pendingStatfsTargets.has(target)) return null;
  pendingStatfsTargets.add(target);
  const call = statfs(target);
  const settled = call.then(
    () => undefined,
    () => undefined,
  ).finally(() => pendingStatfsTargets.delete(target));
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`statfs ${target} exceeded ${deadlineMs}ms; skipping until it answers`);
      resolve(null);
    }, deadlineMs);
    timer.unref();
  });
  try {
    return await Promise.race([call, deadline]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    void settled;
  }
}
