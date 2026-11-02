// Why the Backups buttons are disabled: running blocks Restore, stopped blocks Back up. Null while loading.
export function backupReason(containerState: string | undefined): string | null {
  if (containerState === undefined) return null;
  return containerState === "running" ? "Stop the server to restore." : "Start the server to back up.";
}
