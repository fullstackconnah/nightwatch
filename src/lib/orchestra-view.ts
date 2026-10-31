import type { OrchestraSnapshot, OrchestratorInFlight, OrchestratorRunState, OrchestratorSummary } from "./types/orchestra.ts";

/** Last ok snapshot, held in module memory so it survives client-side navigation but not a reload. */
let lastOk: OrchestraSnapshot | null = null;
export const trackLastOk = (d?: OrchestraSnapshot) => (d?.status === "ok" ? (lastOk = d) : lastOk);
export const resetLastOk = () => { lastOk = null; };

/** Pure copy and badge logic for the Orchestra page, kept free of React so node:test can pin it. */

export const CHECKPOINT_MAX = 300;
// Mirrors QUIET_MS / MAX_MS in orchestra src/sources/markers.js: quiet for 20 min, but not so long it is a dead marker.
const STALL_MIN = 20;
const STALL_MAX = 360;

export type PageKind = "loading" | "load-error" | "unconfigured" | "band";

export function pageKind(a: { isLoading: boolean; hasData: boolean; hasError: boolean; status?: string }): PageKind {
  if (!a.hasData) return a.hasError ? "load-error" : "loading";
  return a.status === "unconfigured" ? "unconfigured" : "band";
}

export function loadErrorCopy(httpStatus?: number): string {
  return httpStatus === 403
    ? "This page needs a full sign-in. The kiosk PIN does not open it."
    : "Could not reach nightwatch's own /api/orchestra.";
}

export function okSentence(list: OrchestratorSummary[]): { head: string; stalled: string | null; tail: string } {
  if (list.length === 0) return { head: "Connected. No orchestrators registered", stalled: null, tail: "." };
  const running = list.filter((x) => x.state === "running").length;
  const stalled = list.reduce((n, x) => n + x.stalledCount, 0);
  return {
    head: `Connected. ${list.length} orchestrator${list.length === 1 ? "" : "s"}, ${running} running`,
    stalled: stalled > 0 ? `${stalled} stalled` : null,
    tail: ".",
  };
}

export interface BandView {
  dot: "dot-unhealthy" | "dot-dead";
  label: string;
  tone: "warn" | "bad";
  sentence: string;
  hint: string;
  /** True when last-known cards are shown beside it. */
  stale: boolean;
  /** The service's own error line; only when there is nothing stale to show. */
  detail: string | null;
}

export function bandView(status: "unauthorized" | "unreachable", a: { detail: string; lastAge?: string }): BandView {
  if (status === "unauthorized") {
    return {
      dot: "dot-unhealthy",
      label: "unauthorized",
      tone: "warn",
      sentence: "Orchestra rejected the token.",
      hint: "The token in Settings no longer matches the one in the service's token file on the PC. Replace it in Settings, under Access.",
      stale: false,
      detail: null,
    };
  }
  const stale = a.lastAge !== undefined;
  return {
    dot: "dot-dead",
    label: "unreachable",
    tone: "bad",
    sentence: "Orchestra is not answering.",
    hint: stale
      ? `The PC is probably off or asleep. Showing what it last reported, ${a.lastAge}.`
      : "The PC is probably off or asleep. This page checks again every 10 seconds.",
    stale,
    detail: stale ? null : a.detail,
  };
}

export function cardBadge(state: OrchestratorRunState, stale: boolean) {
  if (stale) return { variant: "neutral" as const, text: `was ${state}`, dot: "dot-stopped" as const };
  switch (state) {
    case "running": return { variant: "ok" as const, text: state, dot: "dot-running" as const };
    case "stalled": return { variant: "warn" as const, text: state, dot: "dot-unhealthy" as const };
    default: return { variant: "neutral" as const, text: state, dot: "dot-stopped" as const };
  }
}

export function checkpointView(raw: string | null): { text: string; cut: boolean; empty: boolean } {
  if (raw === null) return { text: "No checkpoint recorded.", cut: false, empty: true };
  // The service already cuts to 300; a length of exactly 300 (or more) means text was lost.
  const cut = raw.length >= CHECKPOINT_MAX;
  return { text: cut ? raw.slice(0, CHECKPOINT_MAX) + "…" : raw, cut, empty: false };
}

export const isStalled = (quietMin: number | null): boolean => quietMin !== null && quietMin >= STALL_MIN && quietMin <= STALL_MAX;

export function inFlightRows(list: OrchestratorInFlight[]): (OrchestratorInFlight & { stalled: boolean })[] {
  return list
    .map((e) => ({ ...e, stalled: isStalled(e.quietMin) }))
    .sort((a, b) => Number(b.stalled) - Number(a.stalled) || (b.quietMin ?? -1) - (a.quietMin ?? -1));
}

export function formatQuiet(quietMin: number | null): string {
  if (quietMin === null) return "no transcript yet";
  return quietMin < 60 ? `quiet ${quietMin}m` : `quiet ${Math.floor(quietMin / 60)}h ${quietMin % 60}m`;
}
