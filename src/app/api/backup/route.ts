import { readBackupStatus } from "@/lib/backup-status-read";
import { drillPayload, type BackupResponse } from "@/lib/backup-status";
import { loadConfig } from "@/lib/config";
import { localDateString } from "@/lib/local-time";
import { snapshotRoute } from "@/lib/snapshot-route";
import { displayTimeZone } from "@/app/kiosk/api/list/tz";

export const dynamic = "force-dynamic";

async function collect(): Promise<BackupResponse> {
  const status = await readBackupStatus();
  try {
    return { ...status, drill: drillPayload(loadConfig().restoreTestedOn, localDateString(displayTimeZone())) };
  } catch {
    return { ...status, drill: null }; // an unreadable config hides the drill row; the backup answer stays 200
  }
}

// Always 200 — see snapshot-route.ts for the contract and why it matters.
export const GET = snapshotRoute({ collect });
