/* Pure parse + state mapping for the ODIP backup status file, which a root
 * cron job on the host rewrites once a day (see backup-status-read.ts for the
 * file IO). No imports and no Node APIs, so the Overview tile can import it in
 * the browser and node:test can load it directly; `now` is always passed in so
 * ages and the "check is old" rule are worked out at render time, never from
 * the file's own `detail` text. */

export type BackupState = "OK" | "STALE" | "FAILED";
export type BackupKind = "backup" | "restore-test";

/** Every kind the tile expects, in display order. */
export const BACKUP_KINDS: readonly BackupKind[] = ["backup", "restore-test"];

export const BACKUP_KIND_LABEL: Record<BackupKind, string> = {
  backup: "Nightly backup",
  "restore-test": "Restore test",
};

/** House tone per state: the Badge variant and the matching `.dot` class. */
export const BACKUP_TONE: Record<BackupState, { variant: "ok" | "warn" | "bad"; dot: string }> = {
  OK: { variant: "ok", dot: "dot-running" },
  STALE: { variant: "warn", dot: "dot-unhealthy" },
  FAILED: { variant: "bad", dot: "dot-dead" },
};

/** The daily check runs every 24 h; 2 h of slack before its silence counts. */
export const CHECK_STALE_MS = 26 * 60 * 60 * 1000;

export interface BackupItem {
  kind: BackupKind;
  state: BackupState;
  /** ISO time of the last success the check saw; null when the kind has no record. */
  at: string | null;
}

/** What /api/backup answers. The raw log line (`ref`) never leaves the server. */
export type BackupStatus =
  | { status: "ok"; checkedAt: string; items: BackupItem[] }
  | { status: "missing" }
  | { status: "unreadable"; reason: string };

const STATES: readonly string[] = ["OK", "STALE", "FAILED"];
const RANK: Record<BackupState, number> = { OK: 0, STALE: 1, FAILED: 2 };

/** `raw` is the file's text, or null when the file does not exist. */
export function parseBackupStatus(raw: string | null): BackupStatus {
  if (raw === null) return { status: "missing" };

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { status: "unreadable", reason: "not valid JSON" };
  }

  const d = doc as { checked_at?: unknown; items?: unknown } | null;
  if (!d || typeof d !== "object") return { status: "unreadable", reason: "not a JSON object" };
  if (typeof d.checked_at !== "string" || isNaN(Date.parse(d.checked_at))) {
    return { status: "unreadable", reason: "no valid checked_at" };
  }
  if (!Array.isArray(d.items)) return { status: "unreadable", reason: "no items list" };

  const items: BackupItem[] = [];
  for (const it of d.items as { kind?: unknown; state?: unknown; at?: unknown }[]) {
    if (!it || !(BACKUP_KINDS as readonly unknown[]).includes(it.kind)) continue; // unknown kinds are someone else's
    if (typeof it.state !== "string" || !STATES.includes(it.state)) {
      return { status: "unreadable", reason: `unknown state ${String(it.state)}` };
    }
    items.push({
      kind: it.kind as BackupKind,
      state: it.state as BackupState,
      at: typeof it.at === "string" && !isNaN(Date.parse(it.at)) ? it.at : null,
    });
  }

  return { status: "ok", checkedAt: d.checked_at, items };
}

export interface BackupSummary {
  /** The check itself has not run for over CHECK_STALE_MS. */
  checkStale: boolean;
  /** One row per BACKUP_KINDS entry, with its effective state. */
  items: BackupItem[];
  worst: BackupState;
}

export function summarizeBackup(s: Extract<BackupStatus, { status: "ok" }>, nowMs: number): BackupSummary {
  const checkStale = nowMs - Date.parse(s.checkedAt) > CHECK_STALE_MS;
  const items = BACKUP_KINDS.map((kind): BackupItem => {
    const found = s.items.find((i) => i.kind === kind);
    if (!found) return { kind, state: "STALE", at: null };
    // An OK read by a check that has stopped running is an old claim, not a current one.
    return checkStale && found.state === "OK" ? { ...found, state: "STALE" } : found;
  });
  const worst = items.reduce<BackupState>((w, i) => (RANK[i.state] > RANK[w] ? i.state : w), "OK");
  return { checkStale, items, worst };
}
