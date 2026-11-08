import type {
  OrchestraSnapshot,
  OrchestraState,
  OrchestratorDetail,
  OrchestratorInFlight,
  OrchestratorSummary,
} from "./types/orchestra.ts";
import { id } from "./attention-copy.ts";

/** Last ok snapshot, held in module memory so it survives client-side navigation but not a reload. */
let lastOk: OrchestraSnapshot | null = null;
export const trackLastOk = (d?: OrchestraSnapshot) => (d?.status === "ok" ? (lastOk = d) : lastOk);
export const resetLastOk = () => { lastOk = null; };

/** Pure copy and badge logic for the AI lanes page, kept free of React so node:test can pin it. */

export const CHECKPOINT_MAX = 300;
// Mirrors QUIET_MS / MAX_MS in orchestra src/sources/markers.js: quiet for 20 min, but not so long it is a dead marker.
const STALL_MIN = 20;
const STALL_MAX = 360;

export type PageKind = "loading" | "load-error" | "unconfigured" | "band";

export function pageKind(a: { isLoading: boolean; hasData: boolean; hasError: boolean; status?: string }): PageKind {
  if (!a.hasData) return a.hasError ? "load-error" : "loading";
  return a.status === "unconfigured" ? "unconfigured" : "band";
}

/** Stale when the service is unreachable or the poll itself failed, and there is a last good snapshot to show. */
export function pageFreshness(a: { status?: string; hasError: boolean; hasLastOk: boolean }): { stale: boolean; connected: boolean } {
  return {
    stale: (a.status === "unreachable" || a.hasError) && a.hasLastOk,
    connected: a.status === "ok" && !a.hasError,
  };
}

export function loadErrorCopy(httpStatus?: number): string {
  return httpStatus === 403
    ? "This page needs a full sign-in. The kiosk PIN does not open it."
    : "Could not reach nightwatch's own /api/orchestra.";
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

export function checkpointView(raw: string | null): { text: string; cut: boolean; empty: boolean } {
  if (raw === null) return { text: "No checkpoint recorded.", cut: false, empty: true };
  // The service already cuts to 300; a length of exactly 300 (or more) means text was lost.
  const cut = raw.length >= CHECKPOINT_MAX;
  return { text: cut ? raw.slice(0, CHECKPOINT_MAX) + "…" : raw, cut, empty: false };
}

export const isStalled = (quietMin: number | null): boolean => quietMin !== null && quietMin >= STALL_MIN && quietMin <= STALL_MAX;
/** The service's own live rule: a marker entry quiet past STALL_MAX is a dead session's leftover. */
export const isLive = (quietMin: number | null): boolean => quietMin !== null && quietMin <= STALL_MAX;

export function inFlightRows(list: OrchestratorInFlight[]): (OrchestratorInFlight & { stalled: boolean })[] {
  return list
    .map((e) => ({ ...e, stalled: isStalled(e.quietMin) }))
    .sort((a, b) => Number(b.stalled) - Number(a.stalled) || (b.quietMin ?? -1) - (a.quietMin ?? -1));
}

/** 24 -> "24m", 125 -> "2h 5m". */
export const mins = (q: number): string => (q < 60 ? `${q}m` : `${Math.floor(q / 60)}h ${q % 60}m`);

/** "a Bash", "an Edit": tool names are single words. */
const aTool = (t: string): string => `${/^[aeiou]/i.test(t) ? "an" : "a"} ${t}`;

export function formatQuiet(quietMin: number | null): string {
  return quietMin === null ? "no transcript yet" : `quiet ${mins(quietMin)}`;
}

/** Lanes the lanes page counts as stuck (laneStuck) but that sent no agent rows, so no agent can be named. */
function rowlessLanes(details: Pick<OrchestratorSummary, "name" | "title" | "inFlight" | "state" | "stalledCount">[]) {
  const lanes = details.filter((o) => o.inFlight.length === 0 && laneStuck(o));
  const [one] = lanes;
  if (!one) return null;
  if (lanes.length === 1) {
    const n = one.stalledCount;
    return {
      headline: `${id(one.title ?? one.name)} has gone quiet`,
      detail: `The service ${n > 0 ? `counts ${n} stalled ${n === 1 ? "agent" : "agents"} here` : "reports this lane as stalled"} but sent no agent details. It may be stuck.`,
      action: "Check it on the AI lanes page.",
    };
  }
  const names = lanes.map((o) => id(o.title ?? o.name));
  return {
    headline: `${lanes.length} lanes have gone quiet`,
    detail: `${lanes.length === 2 ? `${names.join(" and ")} sent` : "They sent"} no agent details. They may be stuck.`,
    action: "Check them on the AI lanes page.",
  };
}

/**
 * The attention-strip item for orchestra, or null. Always a warning (attention.ts), never critical. No
 * number in the headline and no `since`: the kiosk keys an alert on headline + since, so a ticking value
 * would re-raise the same alert every poll. The duration lives in the detail.
 * Unreachable speaks only when the last good reading had work in flight (`lastInFlight`, 0 before any good
 * reading): a PC that sleeps after its work is done must not leave an item on the wall all night.
 */
export function orchestraAttention(
  status: OrchestraState,
  details: Pick<OrchestratorSummary, "name" | "title" | "inFlight" | "state" | "stalledCount">[],
  lastInFlight = 0,
): { headline: string; detail: string; action: string } | null {
  if (status === "unreachable") {
    if (lastInFlight <= 0) return null;
    const n = lastInFlight === 1 ? "1 agent was" : `${lastInFlight} agents were`;
    return {
      headline: "The PC's agent service stopped answering",
      detail: `${n} running. The PC may be off or asleep.`,
      action: "Wake the PC, or ignore this if you turned it off.",
    };
  }
  if (status === "unauthorized") {
    return {
      headline: "The PC's agent service refused the key",
      detail: "nightwatch's saved access token is wrong or out of date, so agents can't be checked.",
      action: "Replace the token in Settings, under Access.",
    };
  }
  if (status !== "ok") return null;
  // A waiting agent (a pending tool call, usually a permission prompt) blocks work now, so it outranks a stalled one.
  const waiting = details
    .flatMap((o) => o.inFlight.filter((e) => e.waiting).map((e) => ({ agent: e.name, orch: o.title ?? o.name, tool: e.waiting!.tool, since: e.waiting!.sinceMin })))
    .sort((a, b) => b.since - a.since);
  const wTop = waiting[0];
  if (wTop) {
    const call = `${id(wTop.agent)} has ${aTool(wTop.tool)} call waiting ${wTop.since}m, usually a permission prompt.`;
    return waiting.length === 1
      ? { headline: `${id(wTop.orch)} is waiting for you`, detail: call, action: "Answer it on the PC." }
      : { headline: `${waiting.length} agents are waiting for you`, detail: `Longest: ${call}`, action: "Answer them on the PC." };
  }
  const stalled = details
    .flatMap((o) => o.inFlight.filter((e) => isStalled(e.quietMin)).map((e) => ({ agent: e.name, orch: o.title ?? o.name, quietMin: e.quietMin })))
    .sort((a, b) => (b.quietMin ?? 0) - (a.quietMin ?? 0));
  const top = stalled[0];
  if (!top) return rowlessLanes(details);
  if (stalled.length === 1) {
    return {
      headline: `${id(top.agent)} has gone quiet`,
      detail: `In ${id(top.orch)}, ${formatQuiet(top.quietMin)}. It may be stuck.`,
      action: "Check it on the AI lanes page.",
    };
  }
  return {
    headline: `${stalled.length} agents have gone quiet`,
    detail: `Longest: ${id(top.agent)} in ${id(top.orch)}, ${formatQuiet(top.quietMin)}. They may be stuck.`,
    action: "Check them on the AI lanes page.",
  };
}

// --- AI lanes page ---------------------------------------------------------------

export type AgentLook = "waiting" | "stalled" | "quiet";
type AgentLike = Pick<OrchestratorInFlight, "quietMin" | "waiting">;

/** A waiting agent is marked whatever its quiet time: a pending tool call is the permission-prompt state. */
export const agentLook = (a: AgentLike): AgentLook => (a.waiting ? "waiting" : isStalled(a.quietMin) ? "stalled" : "quiet");
/** How full the 2 px track is: it fills toward the 20-minute stall mark. */
export const stallFill = (q: number | null): number => (q === null ? 0 : Math.min(q, STALL_MIN) / STALL_MIN);

type LaneLike = Pick<OrchestratorSummary, "state" | "stalledCount" | "inFlight">;
const needing = (l: LaneLike) => l.inFlight.filter((a) => agentLook(a) !== "quiet");
/** A live lane is stuck when the service counts a stalled agent or any agent is waiting or stalled. Stopped and unread lanes never are. */
export const laneStuck = (l: LaneLike): boolean =>
  (l.state === "running" || l.state === "stalled") && (l.state === "stalled" || l.stalledCount > 0 || needing(l).length > 0);

export interface LaneTally { stuck: number; running: number; stopped: number; unknown: number; agents: number }
export function laneTally(list: OrchestratorSummary[]): LaneTally {
  const t: LaneTally = { stuck: 0, running: 0, stopped: 0, unknown: 0, agents: 0 };
  for (const l of list) {
    t.agents += l.inFlight.length || l.inFlightCount;
    if (laneStuck(l)) t.stuck++;
    else if (l.state === "stopped") t.stopped++;
    else if (l.state === "unknown") t.unknown++;
    else t.running++;
  }
  return t;
}

/** Home's order and words; a zero segment is left out. */
export function tallySegments(t: LaneTally): { n: number; label: string }[] {
  return [
    { n: t.stuck, label: "stuck" },
    { n: t.running, label: "running" },
    { n: t.stopped, label: "stopped" },
    { n: t.unknown, label: "not read" },
    { n: t.agents, label: t.agents === 1 ? "agent in flight" : "agents in flight" },
  ].filter((s) => s.n > 0);
}

/** Home's one line: Lanes tally in Home's order, without the agent count. */
export const homeLanesText = (list: OrchestratorSummary[]): string =>
  tallySegments(laneTally(list)).filter((s) => !s.label.startsWith("agent")).map((s) => `${s.n} ${s.label}`).join(", ") || "no lanes";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The page's one sentence, from every agent in flight (held or not). Null when it would be a guess (stale). */
export function laneSentence(list: OrchestratorSummary[], { stale }: { stale: boolean }): string | null {
  if (stale) return null;
  if (list.length === 0) return "No lanes registered.";
  const t = laneTally(list);
  const stuck = list.filter(laneStuck);
  if (stuck.length === 0) {
    const live = `${plural(t.running, "lane")} running, ${plural(t.agents, "agent")} in flight.`;
    return t.unknown > 0 ? `${live} ${t.unknown} could not be read.` : `Nothing needs you. ${live}`;
  }
  if (stuck.length > 1) return `${stuck.length} lanes need you: ${andList(stuck.map((l) => l.name))}.`;
  const [l] = stuck;
  const need = needing(l);
  if (need.length === 0) return `${l.name} needs you.`;
  if (need.length > 1) return `${l.name} needs you: ${need.length} agents need a look.`;
  const [a] = need;
  return a.waiting
    ? `${l.name} needs you: ${a.name} has ${aTool(a.waiting.tool)} call waiting ${a.waiting.sinceMin}m, usually a permission prompt.`
    : `${l.name} needs you: ${a.name} has been quiet ${mins(a.quietMin ?? 0)}.`;
}

/** The lane's attention line. `who` is the one agent the component sets in ink 600; it is never warn. */
export function laneAttention(l: OrchestratorSummary, stale: boolean): { text: string; who: string | null; tone: "ink" | "dim" } {
  const dim = (text: string) => ({ text, who: null, tone: "dim" as const });
  if (stale) return dim("Live state unknown while Orchestra is not answering.");
  if (l.state === "unknown") return dim("Orchestra could not read this lane.");
  if (l.state === "stopped") return dim("Stopped. Start it from the PC.");
  const need = needing(l);
  const waiting = need.filter((a) => a.waiting).sort((a, b) => (b.waiting?.sinceMin ?? 0) - (a.waiting?.sinceMin ?? 0))[0];
  if (waiting?.waiting) {
    return { text: `${waiting.name} · ${waiting.waiting.tool} call waiting ${waiting.waiting.sinceMin}m, usually a permission prompt. Answer it on the PC.`, who: waiting.name, tone: "ink" };
  }
  const worst = [...need].sort((a, b) => (b.quietMin ?? 0) - (a.quietMin ?? 0));
  if (worst.length > 1) return { text: `${worst.length} agents need you: ${worst.map((a) => a.name).join(", ")}.`, who: null, tone: "ink" };
  if (worst.length === 1) return { text: `${worst[0].name} has been quiet ${mins(worst[0].quietMin ?? 0)}. Check its session on the PC.`, who: worst[0].name, tone: "ink" };
  if (l.state === "stalled") return { text: "Quiet for too long. Check its session on the PC.", who: null, tone: "ink" };
  return dim("");
}

export function laneBadge(l: OrchestratorSummary, stale: boolean) {
  const stuck = laneStuck(l);
  const word = l.state === "unknown" ? "not read" : l.state === "stopped" ? "stopped" : stuck ? "stuck" : "running";
  if (stale) return { text: `was ${word}`, tone: "neutral" as const, mark: false, dot: "dot-stopped" as const };
  if (stuck) return { text: word, tone: "warn" as const, mark: true, dot: "dot-unhealthy" as const };
  if (word === "running") return { text: word, tone: "ok" as const, mark: false, dot: "dot-running" as const };
  return { text: word, tone: "neutral" as const, mark: false, dot: "dot-stopped" as const };
}

/** The partial band's words: lanes the service could not read show as unknown, never stopped. */
export function partialBand(list: OrchestratorSummary[]): string | null {
  const n = list.filter((l) => l.state === "unknown").length;
  return n > 0 ? `${n} of ${list.length} lanes could not be read. They show as unknown, not stopped.` : null;
}

/** The hold: a strip's members are fixed at first paint; joins and leaves wait behind the pill until it is tapped. */
export function holdMembers(held: readonly string[], next: readonly string[]): { shown: string[]; fresh: number; left: number } {
  return { shown: [...held], fresh: next.filter((n) => !held.includes(n)).length, left: held.filter((h) => !next.includes(h)).length };
}
export const holdPillText = (m: { fresh: number; left: number }): string => (m.fresh ? `${m.fresh} new · show` : "Update list");

export const laneRowId = (lane: string) => `lane-${lane}`;
export const agentRowId = (lane: string, agent: string) => `${lane}/${agent}`;

export const SLOTS = 4;
export type Slot = { kind: "agent"; id: string; name: string } | { kind: "more"; id: string; n: number } | { kind: "free"; id: string };
/** Four slots always: free ones fill; a fifth agent turns slot 4 into "Show n more". */
export function slotLayout(lane: string, names: readonly string[]): Slot[] {
  const over = names.length > SLOTS;
  const shown = over ? names.slice(0, SLOTS - 1) : names;
  return [
    ...shown.map((name): Slot => ({ kind: "agent", id: agentRowId(lane, name), name })),
    ...(over ? [{ kind: "more", id: `${lane}/more`, n: names.length - shown.length } as Slot] : []),
    ...Array.from({ length: over ? 0 : SLOTS - shown.length }, (_, i): Slot => ({ kind: "free", id: `${lane}/free-${i}` })),
  ];
}
