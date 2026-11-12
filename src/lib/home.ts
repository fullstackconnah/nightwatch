/* Pure Home logic (the attention report's view). Type-only imports so node:test can load it (no "@/" alias).
 * Times come in pre-formatted, except `clock`. */
import type { AttentionHit, AttentionReport, ProbeId } from "./attention-report.ts";
import { ACTION_LINE, fixFor } from "./fix-sheet.ts";

export type Tone = "ok" | "warn" | "bad" | "pending";
const DAY = 86_400_000;
export const WEEK_MS = 7 * DAY;

/** The pinned 7-day start, re-pinned to `now - 7d` once it has drifted over an hour; same value back means no re-render. */
export const refreshedWeekSince = (prev: number | null, now: number): number | null =>
  prev === null || now - WEEK_MS - prev <= 3_600_000 ? prev : now - WEEK_MS;
export type ChangesRange = "recent" | "week";
const DOCKER_PROBES: readonly ProbeId[] = ["crashes", "restarts", "health"];
const FEED_CLOSED_SLOTS = 4;
export const LAST_LOOKED_KEY = "home-last-looked";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lc = (s: string) => s.replace(/^The /, "the ");

/** hh:mm. With `offsetMin` the zone is fixed (tests); without, the viewer's local time. */
export function clock(t: number | string, offsetMin?: number): string {
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, "0");
  if (offsetMin === undefined) return `${two(d.getHours())}:${two(d.getMinutes())}`;
  const s = new Date(d.getTime() + offsetMin * 60_000);
  return `${two(s.getUTCHours())}:${two(s.getUTCMinutes())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Today 14:02" on the viewer's local today, else "Mon 14:02". offsetMin as in clock() (tests only). */
export function dayClock(t: number | string, now: number, offsetMin?: number): string {
  const shift = (x: number | string) => new Date(new Date(x).getTime() + (offsetMin ?? 0) * 60_000);
  const parts = (d: Date) =>
    offsetMin === undefined
      ? { day: d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate(), wd: d.getDay() }
      : { day: d.getUTCFullYear() * 400 + d.getUTCMonth() * 31 + d.getUTCDate(), wd: d.getUTCDay() };
  // Local get* on the unshifted date; UTC get* on the shifted one (the same split clock() makes).
  const e = parts(offsetMin === undefined ? new Date(t) : shift(t));
  const n = parts(offsetMin === undefined ? new Date(now) : shift(now));
  return `${e.day === n.day ? "Today" : WEEKDAYS[e.wd]} ${clock(t, offsetMin)}`;
}

/** 7-day range: null until the report on screen is the one asked for (keepPreviousData shows the old one). */
export function changesFor<C extends { since: string }>(
  changes: C | null,
  sinceMs: number | null,
  range: ChangesRange,
): C | null {
  if (range === "recent" || !changes) return changes;
  return sinceMs !== null && Math.abs(Date.parse(changes.since) - sinceMs) <= 60_000 ? changes : null;
}

// ---- needs-you rows ----

export interface HomeRow {
  id: string;
  probe?: ProbeId; // set on hits; absent on failed:* rows
  subject: string;
  severity: "warn" | "bad";
  headline: string;
  detail?: string;
  action?: string;
  since: string; // ISO
  owner: { href: string; label: string };
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const LOGS = { href: "/logs", label: "Open Logs" };

/** Every hit, plus a row for each failed probe: a failed probe is never zero. The 3 Docker probes are one bad row, first. */
export function homeRows(r: AttentionReport): HomeRow[] {
  const failed = r.probes.flatMap((p) => (p.state === "failed" ? [p] : []));
  const rows: HomeRow[] = [];
  const dockerFailed = failed.filter((p) => DOCKER_PROBES.includes(p.id));
  if (dockerFailed.length > 0) {
    rows.push({
      id: "failed:docker",
      subject: "failed:docker",
      severity: "bad",
      headline: "Can't reach Docker",
      detail: "App status and health checks are unknown, not zero. Disks, backup and the host still report.",
      action: "Check that the Docker socket proxy is running, then reload.",
      since: r.checkedAt,
      owner: LOGS,
    });
  }
  for (const h of r.hits as AttentionHit[]) {
    const fix = fixFor(h);
    // Home-only action line for rows that open a fix sheet; attention-copy.ts (kiosk) is unchanged.
    const action = fix ? (fix.action ? ACTION_LINE.fix : ACTION_LINE.logs) : h.action;
    rows.push({ ...h, action, since: h.since ?? h.firstSeen });
  }
  for (const p of failed) {
    if (DOCKER_PROBES.includes(p.id)) continue;
    rows.push({
      id: `failed:${p.id}`,
      subject: `failed:${p.id}`,
      severity: "warn",
      headline: `The ${p.label} check failed`,
      detail: clip(p.error, 140),
      action: "It retries every 30 s; Logs has the cause.",
      since: r.checkedAt,
      owner: LOGS,
    });
  }
  return rows;
}

// ---- the set gate (R1) ----

export interface GateResult {
  shown: string[];
  waiting: string[];
  fixed: string[];
}
/** `prev` is the committed id list (null before first paint). First paint shows all; later new ids wait, cleared ids stay. */
export function gate(prev: readonly string[] | null, live: readonly string[]): GateResult {
  if (prev === null) return { shown: live.slice(), waiting: [], fixed: [] };
  const liveSet = new Set(live);
  const shownSet = new Set(prev);
  return {
    shown: prev.slice(),
    waiting: live.filter((id) => !shownSet.has(id)),
    fixed: prev.filter((id) => !liveSet.has(id)),
  };
}
/** The tap: the server's order, new in, fixed out. */
export const reveal = (live: readonly string[]): string[] => live.slice();

/** Fixed ids keep their index in `shown`; the remaining positions take `rankedLive` in order. */
export function slotOrder(shown: readonly string[], fixed: ReadonlySet<string>, rankedLive: readonly string[]): string[] {
  let i = 0;
  return shown.map((id) => (fixed.has(id) ? id : (rankedLive[i++] ?? id)));
}

export function pillText(waiting: number, fixed: number): string {
  if (waiting > 0) return `${waiting} new · show`;
  return fixed > 0 ? `${fixed} fixed · hide` : "";
}

// ---- the answer ----

export interface AnswerInput {
  report: AttentionReport | null;
  /** The report fetch failed. */
  error: boolean;
  running: number | null;
  /** Pre-formatted age ("9 h"), only when the backup status is ok. */
  backupAgo: string | null;
  /** The containers fetch failed, so the app count is unknown. */
  containersFailed?: boolean;
}
export function answerFor(i: AnswerInput): { tone: Tone; text: string } {
  const { report: r } = i;
  if (i.error) return { tone: "pending", text: "Can't get an answer from the box right now" };
  if (!r) return { tone: "pending", text: "Checking the box…" };
  const rows = homeRows(r);
  if (r.probes.some((p) => p.state === "failed" && DOCKER_PROBES.includes(p.id))) {
    const more = rows.length - 1;
    return {
      tone: "bad",
      text: `Can't reach Docker, so app health is unknown${more > 0 ? `. ${more} more ${more === 1 ? "thing needs" : "things need"} you` : ""}`,
    };
  }
  if (r.hits.length > 0) {
    const worst = r.hits[0];
    const n = rows.length;
    return {
      tone: worst.severity,
      text: n === 1 ? `1 thing needs you: ${lc(worst.headline)}` : `${n} things need you. First: ${lc(worst.headline)}`,
    };
  }
  const failed = r.probes.filter((p) => p.state === "failed");
  if (failed.length > 0) {
    return {
      tone: "pending",
      text: `Nothing wrong found, but ${failed.length === 1 ? `the ${failed[0].label.toLowerCase()} check` : `${failed.length} checks`} failed`,
    };
  }
  const out = r.probes.filter((p) => p.state === "pending").length;
  if (out > 0) return { tone: "pending", text: `Nothing wrong so far, ${plural(out, "check", "checks")} still out` };
  const apps = i.running === null ? "" : ` ${i.running} apps running${i.backupAgo ? `, backup ran ${i.backupAgo} ago` : ""}`;
  return { tone: "ok", text: `All clear.${apps}${i.containersFailed ? " App count unknown." : ""}` };
}

/** The status slot's probe line. */
export function probeLine(r: AttentionReport | null, at: string): string {
  if (!r) return "Asking 9 sources…";
  const answered = r.probes.filter((p) => p.state === "answered").length;
  const bits = [`${answered} of ${r.probes.length} checks answered at ${at}`];
  const waiting = r.probes.filter((p) => p.state === "pending").map((p) => p.label.toLowerCase());
  const failed = r.probes.filter((p) => p.state === "failed").map((p) => p.label.toLowerCase());
  if (waiting.length) bits.push(`waiting on ${waiting.join(", ")}`);
  if (failed.length) bits.push(`${failed.join(" and ")} failed`);
  return bits.join(" · ");
}

/** The line shown while the committed list is empty. */
export function calmLine(r: AttentionReport | null, waiting: number, at: string): string {
  if (!r) return "Unknown.";
  if (waiting > 0) return `Nothing listed yet. ${waiting} new since ${at}.`;
  const out = r.probes.filter((p) => p.state === "pending").map((p) => p.label.toLowerCase());
  if (out.length) return `Nothing so far. Still waiting on ${out.join(" and ")}.`;
  return `Nothing. Every check answered at ${at}.`;
}

// ---- the change feed (R2) ----

/** A fixed box: S = 4 closed, or the count at the moment of the tap when open. Newest first; the rest is overflow. */
export function feedSlots(events: readonly { id: string }[], open: boolean, openS: number) {
  const S = open ? Math.max(openS, FEED_CLOSED_SLOTS) : FEED_CLOSED_SLOTS;
  return { S, ids: events.slice(0, S).map((e) => e.id), overflow: Math.max(0, events.length - S) };
}

/** R3: an event whose subject is already listed in Needs you (resolved rows included) is not repeated here. */
export function dropListed<E extends { subjects: readonly string[] }>(events: readonly E[], listed: ReadonlySet<string>): E[] {
  return events.filter((e) => !e.subjects.some((s) => listed.has(s)));
}

/** Age for the answer line and the stale bar: "20 s", "40 min", "9 h", "3 d". */
export function ageText(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

// ---- last looked (R6) ----

/** `raw` is the localStorage string (ms epoch). Anything unusable falls back to the last 24 h. */
export function parseLastLooked(raw: string | null | undefined, now: number): { since: number; label: "last 24 h" | null } {
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0 && n <= now && now - n <= 30 * DAY) return { since: n, label: null };
  return { since: now - DAY, label: "last 24 h" };
}

const DISK_NAME_MAX = 13;
/** Home's Disks value: "root 41% · media 68%". The name is the Resources HOST DISK mount, "/" shown as root, else its last segment. */
export function diskLine(disks: readonly { mount: string; percent: number }[]): string {
  return disks
    .map((d) => {
      const name = d.mount === "/" ? "root" : (d.mount.split("/").filter(Boolean).pop() ?? "");
      const short = name.length > DISK_NAME_MAX ? `${name.slice(0, DISK_NAME_MAX - 1)}…` : name;
      return `${short ? `${short}\u00a0` : ""}${Math.round(d.percent)}%`;
    })
    .join(" · ");
}
