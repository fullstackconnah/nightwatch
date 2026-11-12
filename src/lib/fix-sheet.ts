/* The fix sheet on a Home "Needs you" row: pure mapping, log clipping and copy. Relative imports so node:test can load it. */
import { ApiError } from "./api-error.ts";
import type { ProbeId } from "./attention-report.ts";
import { isContainerId } from "./container-id.ts";
import { LOGS_FAILED } from "./detail-states.ts";

export type FixAction = "start" | "restart";
export interface Fix {
  name: string;
  action: FixAction | null;
  cause: string;
  logsUrl: string;
  actionUrl: string;
}

export const CAUSE = {
  crashes:
    "It exited with an error. The last lines below usually say why. Starting it runs the same setup again, so if the cause is still there it will stop again.",
  restarts:
    "Docker keeps starting it and it keeps failing. A restart won't help until the error below is fixed, so there's no button here.",
  health: "It's running, but its own health check fails. A restart clears a stuck process; it won't fix a bad setting.",
} as const;

export const LOGS_COPY = {
  loading: "Reading the last lines…",
  empty: "Nothing in its log yet.",
  offline: "You're offline. Logs load when you're back.",
  gone: "That container no longer exists.",
  signedOut: "You're signed out. Sign in again to read its log.",
  failed: LOGS_FAILED,
} as const;

const ACTION_OF = { crashes: "start", health: "restart", restarts: null } as const;
/** The Home-only action line (PLAN-AMEND 7); the kiosk keeps attention-copy.ts. */
export const ACTION_LINE = { fix: "Open for the last log lines and a fix.", logs: "Open for the last log lines." } as const;

export function fixFor(row: { probe?: ProbeId; subject: string }): Fix | null {
  const p = row.probe;
  if (p !== "crashes" && p !== "restarts" && p !== "health") return null;
  if (!row.subject.startsWith("container:")) return null;
  const name = row.subject.slice("container:".length);
  if (!isContainerId(name)) return null;
  const base = `/api/docker/containers/${encodeURIComponent(name)}`;
  return { name, action: ACTION_OF[p], cause: CAUSE[p], logsUrl: `${base}/logs?tail=20`, actionUrl: `${base}/action` };
}

const two = (n: number) => String(n).padStart(2, "0");
/** HH:MM:SS; with `offsetMin` the zone is fixed (tests), without it the viewer's local time. */
function hms(t: number, offsetMin?: number): string {
  if (offsetMin === undefined) {
    const d = new Date(t);
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  }
  const s = new Date(t + offsetMin * 60_000);
  return `${two(s.getUTCHours())}:${two(s.getUTCMinutes())}:${two(s.getUTCSeconds())}`;
}

const STAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z\s?/;
// Code points, so a surrogate pair is never cut.
const clip = (s: string, max: number) => {
  const cp = Array.from(s);
  return cp.length <= max ? s : `${cp.slice(0, max).join("")}…`;
};

/** The last `n` non-blank lines as "HH:MM:SS message", each message clipped to `max` chars plus an ellipsis. Plain strings only. */
export function tailLines(logs: string, offsetMin?: number, n = 20, max = 200): string[] {
  return logs
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .map((l) => {
      const m = STAMP.exec(l);
      if (!m) return clip(l, max);
      return `${hms(Date.parse(`${m[1]}Z`), offsetMin)} ${clip(l.slice(m[0].length), max)}`;
    });
}

const isOffline = (e: unknown, online: boolean) => !online || e instanceof TypeError;

export function actionErrorText(e: unknown, action: FixAction, online: boolean): { text: string; rearm: boolean } {
  if (!online) return { text: "You're offline. Nothing was sent.", rearm: true };
  // Online but no answer: the request may have gone out (dropped connection, the dashboard's own container restarting).
  if (e instanceof TypeError) return { text: "Couldn't confirm it went through. This row updates at the next check, within 30 s.", rearm: false };
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 401) return { text: `You're signed out. Sign in again to ${action} it.`, rearm: false };
  if (status === 404) return { text: LOGS_COPY.gone, rearm: false };
  const msg = e instanceof ApiError && !/^HTTP \d+$/.test(e.message) ? clip(e.message, 200) : `Couldn't ${action} it. Try again.`;
  return { text: msg, rearm: true };
}

export function logsErrorText(e: unknown, online: boolean): { kind: "offline" | "signedout" | "gone" | "failed"; text: string } {
  if (isOffline(e, online)) return { kind: "offline", text: LOGS_COPY.offline };
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 401) return { kind: "signedout", text: LOGS_COPY.signedOut };
  if (status === 404) return { kind: "gone", text: LOGS_COPY.gone };
  return { kind: "failed", text: LOGS_COPY.failed };
}

export function doneText(action: FixAction, at: number, offsetMin?: number): string {
  return `${action === "restart" ? "Restarted" : "Started"} at ${hms(at, offsetMin).slice(0, 5)}. This row clears at the next check, within 30 s.`;
}

/** True when a report newer than the action still lists the hit: show "Still failing" and re-arm. */
export const stillFailing = (doneAt: number, checkedAt: string, live: boolean): boolean => live && Date.parse(checkedAt) > doneAt;
