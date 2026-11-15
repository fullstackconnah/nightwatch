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

/** How old an item's last success may be before it is late: a daily backup 24 h + 2 h, the weekly restore test 7 d + 2 h. */
export const ITEM_LIMIT_MS: Record<BackupKind, number> = {
  backup: CHECK_STALE_MS,
  "restore-test": (7 * 24 + 2) * 60 * 60 * 1000,
};

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
  /** The check itself has not run for over CHECK_STALE_MS. Informational: it no longer turns items STALE. */
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
    // An OK item is late only when its own last success is past its own limit; an old check alone does not make it so.
    const late = found.state === "OK" && (found.at === null || nowMs - Date.parse(found.at) > ITEM_LIMIT_MS[kind]);
    return late ? { ...found, state: "STALE" } : found;
  });
  const worst = items.reduce<BackupState>((w, i) => (RANK[i.state] > RANK[w] ? i.state : w), "OK");
  return { checkStale, items, worst };
}

/** Attention headline naming every item that is not OK, failed ones first: "ODIP restore test failed; nightly backup is late". */
export function backupHeadline(s: BackupSummary): string {
  const bad = s.items.filter((i) => i.state !== "OK").sort((a, b) => RANK[b.state] - RANK[a.state]);
  const verb = (i: BackupItem, plural: boolean) => (i.state === "FAILED" ? "failed" : plural ? "are late" : "is late");
  const name = (i: BackupItem) => BACKUP_KIND_LABEL[i.kind].toLowerCase();
  if (bad.length === 2 && bad[0].state === bad[1].state) return `ODIP ${name(bad[0])} and ${name(bad[1])} ${verb(bad[0], true)}`;
  return "ODIP " + bad.map((i) => `${name(i)} ${verb(i, false)}`).join("; ");
}

/** ISO time of the last nightly backup, only while the tile would show it OK (same stale test as BackupTile); else null. */
export function nightlyAt(s: BackupStatus | undefined, nowMs: number): string | null {
  if (s?.status !== "ok") return null;
  const n = summarizeBackup(s, nowMs).items.find((i) => i.kind === "backup");
  return n?.state === "OK" ? n.at : null;
}

// --- the owner's own restore drill: the day a backup was last restored by hand ------------------

/** Up to this many whole days since the drill is OK; one more is due. */
export const DRILL_LIMIT_DAYS = 90;
export const DRILL_INVALID = "That isn't a real date. Pick one from the calendar.";
export const DRILL_TOO_OLD = "Pick a date from 2000 on.";
export const DRILL_FUTURE = "That date hasn't happened yet. Enter the day you last tested a restore.";

/** `today` is the display-zone date (localDateString), so a count never depends on the server's UTC day. */
export type RestoreDrill = { testedOn: string | null; today: string };
export type BackupResponse = BackupStatus & { drill: RestoreDrill | null };

// Whole-day numbers in UTC, so DST never moves a count (same two lines as bin-night.ts, which this file cannot import).
const dayNumber = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
const isoOf = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);
/** A real calendar day written exactly YYYY-MM-DD (2026-02-30 and 0050-01-01 are not). */
const realDay = (s: string): boolean => s.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(dayNumber(s)) === s;

export function drillAge(d: RestoreDrill): { state: "none" } | { state: "ok" | "due"; days: number } {
  if (!d.testedOn) return { state: "none" };
  const days = Math.max(0, dayNumber(d.today) - dayNumber(d.testedOn));
  return { state: days > DRILL_LIMIT_DAYS ? "due" : "ok", days };
}

/** The trust boundary for a typed date: blank clears (value null), anything else must be a real day from 2000 to today. */
export function checkRestoreDate(raw: unknown, today: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const t = (raw as { testedOn?: unknown } | null | undefined)?.testedOn;
  if (typeof t !== "string") return { ok: false, error: DRILL_INVALID };
  const s = t.trim();
  if (s === "") return { ok: true, value: null };
  if (!realDay(s)) return { ok: false, error: DRILL_INVALID };
  if (s < "2000-01-01") return { ok: false, error: DRILL_TOO_OLD };
  if (s > today) return { ok: false, error: DRILL_FUTURE };
  return { ok: true, value: s };
}

/** Sets or clears only `restoreTestedOn` on a copy of the config; a rejected value changes nothing. */
export function applyRestoreDrill<T extends object>(config: T, raw: unknown, today: string): { next: T & { restoreTestedOn?: string } } | { error: string } {
  const c = checkRestoreDate(raw, today);
  if (!c.ok) return { error: c.error };
  const next: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  if (c.value === null) delete next.restoreTestedOn;
  else next.restoreTestedOn = c.value;
  return { next: next as T & { restoreTestedOn?: string } };
}

/** What /api/backup sends for the stored date: a hand-edited bad value reads as never; a date after today is kept (drillAge clamps it to 0). */
export const validStoredDrill = (stored: unknown): string | null => (typeof stored === "string" && realDay(stored) && stored >= "2000-01-01" ? stored : null);
export function drillPayload(stored: unknown, today: string): RestoreDrill {
  return { testedOn: validStoredDrill(stored), today };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-12" as "12 Oct 2026", from the string itself so no zone can shift the day. */
export const drillDateText = (iso: string): string => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
/** "today", "1 day ago", "35 days ago". */
export const drillAgeText = (days: number): string => (days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);
