import { readBackupStatus } from "@/lib/backup-status-read";
import { snapshotRoute } from "@/lib/snapshot-route";

export const dynamic = "force-dynamic";

// Always 200 — see snapshot-route.ts for the contract and why it matters.
export const GET = snapshotRoute({ collect: readBackupStatus });
