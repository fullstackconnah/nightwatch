// Why the Backups buttons are disabled: a live server blocks Restore, a stopped one blocks Back up. Null while loading.
/** The only states a world may be restored under: no JVM holds it open. A missing container (undefined) is allowed too. */
export const STOPPED_STATES = ["exited", "created", "dead"];
export const canRestore = (state: string | undefined) => state === undefined || STOPPED_STATES.includes(state);

export function backupReason(containerState: string | undefined): string | null {
  if (containerState === undefined) return null;
  return canRestore(containerState) ? "Start the server to back up." : "Stop the server to restore.";
}

/** Server-side twin of the UI guard: restoring under a live, paused or restarting server is refused (409). */
export function restoreRefusal(containerState: string | undefined): string | null {
  return canRestore(containerState) ? null : "Stop the server before restoring a backup.";
}
