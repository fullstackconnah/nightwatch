// Why the Backups buttons are disabled: running blocks Restore, stopped blocks Back up. Null while loading.
export function backupReason(containerState: string | undefined): string | null {
  if (containerState === undefined) return null;
  return containerState === "running" ? "Stop the server to restore." : "Start the server to back up.";
}

/** Server-side twin of the UI guard: restoring into a running world is refused (409). */
export function restoreRefusal(containerState: string | undefined): string | null {
  return containerState === "running" ? "Stop the server before restoring a backup." : null;
}
