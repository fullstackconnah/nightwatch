import fsp from "node:fs/promises";
import { HOST_ROOTFS } from "@/lib/host-metrics";
import { parseBackupStatus, type BackupStatus } from "@/lib/backup-status";

/** Read at call time, not as a module const, so the test stack can point it at a fixture. */
export function backupStatusPath(): string {
  return process.env.ODIP_BACKUP_STATUS_PATH || `${HOST_ROOTFS}/mnt/docker/backups/status/odip-backup.json`;
}

/**
 * Reads the file on every call, no cache: it is a few hundred bytes, rewritten
 * once a day, and the attention probe that also reads it is memoised already.
 * Never throws — a missing file is "no status yet" (first boot, or the folder
 * not mounted), anything else unreadable is a state the tile renders.
 */
export async function readBackupStatus(): Promise<BackupStatus> {
  let raw: string | null;
  try {
    raw = await fsp.readFile(backupStatusPath(), "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      return { status: "unreadable", reason: code === "EACCES" ? "permission denied" : `read failed (${code ?? "unknown"})` };
    }
    raw = null;
  }
  return parseBackupStatus(raw);
}
