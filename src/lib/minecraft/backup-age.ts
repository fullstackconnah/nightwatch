// Relative imports with explicit .ts: node --test has no "@/" resolver.
import { Memo } from "../cache.ts";
import type { McBackup, McInstance } from "./manager.ts";
import { newestBackup } from "./page-model.ts";

/** A world with no backup for two weeks is one the owner has probably forgotten about. */
export const BACKUP_WARN_DAYS = 14;
/** The backup list changes when a backup runs (nightly at most), and Home's snapshot runs every 30 s, so Home reads it at most every 15 minutes. */
export const BACKUP_TTL_MS = 15 * 60_000;
/** A failed read (manager down) is cheap to retry, so it does not hold for the full TTL. */
export const BACKUP_RETRY_MS = 5 * 60_000;

const DAY_MS = 86_400_000;
/** The stack backs up every 24 h (BACKUP_INTERVAL), so 2 days covers a new world's first nightly run plus slack. */
export const BACKUP_GRACE_MS = 2 * DAY_MS;

export type BackupVerdict = { kind: "ok" } | { kind: "never" } | { kind: "stale"; days: number };
export interface BackupRead {
  instances: Pick<McInstance, "slug" | "createdAt">[];
  backups: McBackup[];
}

const OK: BackupVerdict = { kind: "ok" };

/**
 * Judges the instance whose newest backup is oldest. A backup whose modifiedAt does not parse is ignored (its age
 * would be NaN and read as fresh). An instance with no usable backup is "never", unless it was created within
 * BACKUP_GRACE_MS, when it is skipped; a missing, unparsable or future createdAt gets no grace. No instances is fine. Run
 * state is not known here, so a stopped instance is judged like a running one.
 */
export function backupVerdict(instances: BackupRead["instances"], backups: McBackup[], now: number): BackupVerdict {
  let oldest = Infinity; // age in ms of the worst instance's newest backup
  for (const { slug, createdAt } of instances) {
    const newest = newestBackup(backups.filter((b) => b.instance === slug && !Number.isNaN(Date.parse(b.modifiedAt))));
    if (!newest) {
      const age = now - Date.parse(createdAt);
      if (age >= 0 && age < BACKUP_GRACE_MS) continue; // NaN and a future createdAt (negative age) get no grace
      return { kind: "never" };
    }
    oldest = Math.max(oldest === Infinity ? 0 : oldest, now - Date.parse(newest.modifiedAt));
  }
  const days = Math.floor(oldest / DAY_MS);
  return oldest !== Infinity && days >= BACKUP_WARN_DAYS ? { kind: "stale", days } : OK;
}

type Reading = { verdict: BackupVerdict; ok: boolean; at: number };

/**
 * Cached reader shaped like cachedExpiringCerts: no manager call inside the TTL, one load in flight, a stale
 * reading returned at once while it refreshes. `fetch` answers null when the manager can't be read; a null or
 * a throw holds the last verdict (none before the first success) and retries after BACKUP_RETRY_MS.
 */
export function cachedBackupVerdict(
  fetch: () => Promise<BackupRead | null>,
  opts: { key: string; now?: () => number },
): () => Promise<BackupVerdict> {
  const now = opts.now ?? Date.now;
  let held: BackupVerdict = OK;
  const memo = new Memo<Reading>({
    key: opts.key,
    ttlMs: BACKUP_TTL_MS,
    now,
    isValid: (r) => r.ok || now() - r.at < BACKUP_RETRY_MS,
    load: async () => {
      try {
        const read = await fetch();
        if (read) held = backupVerdict(read.instances, read.backups, now());
        return { verdict: held, ok: read !== null, at: now() };
      } catch {
        return { verdict: held, ok: false, at: now() };
      }
    },
  });
  return async () => {
    const last = memo.peek();
    const next = memo.get(); // starts the refresh; never rejects: load catches
    return (last ?? (await next)).verdict;
  };
}
