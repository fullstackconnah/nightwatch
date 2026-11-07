/* /hermes's whole story in one pure function: the head (chip, answer, evidence, notice), the four strips, which strip
 * the answer names, and which writes are on. The daemon's upstream `detail` (it can hold a host) is never read, and an
 * address inside a loop error is redacted. Type-only imports so node:test can load it. Section 5 of the strips pattern 4
 * shape brief is the spec; page-model.test.ts has a case per state. */
import { connectionHead } from "../integration-head.ts";
import { ageText } from "../home.ts";
import { failedRunText } from "../resource-ui-view.ts";
import type { HermesActivityResponse, HermesJob, HermesJobKind, HermesStatusOk, HermesStatusResponse } from "../types/hermes.ts";

export type StripId = "loops" | "runs" | "ask" | "activity";
export type WriteId = "run-digest" | "test-alert" | "ask";
export type Tone = "ok" | "neutral" | "warn" | "bad";

/** The single Hermes job slot the page owns (R19): the shape of useHermesRun()'s result, without its functions. */
export interface RunInput {
  starting: boolean;
  /** Set once start() resolved; with no job loaded yet the run is still pending. */
  jobId?: string | null;
  /** The kind of the run last started from this page. */
  kind: HermesJobKind | null;
  job: { ok: true; job: HermesJob } | { ok: false; status: string; detail: string } | undefined;
  startError: string | null;
}
export interface ModelInput {
  status: HermesStatusResponse | undefined;
  activity: HermesActivityResponse | undefined;
  /** The poll is failing right now (SWR keeps the last good `status`). */
  loadError: boolean;
  run: RunInput;
  /** ms of the last good answer, null before the first. */
  lastOkAt: number | null;
  now: number;
}
export interface Strip {
  id: StripId;
  title: string;
  state: string;
  tone: "warn" | "bad" | null;
}
export interface Model {
  chip: { tone: Tone; label: string };
  answer: string;
  evidence: string;
  notice: string | null;
  link: { href: string; label: string } | null;
  strips: Strip[];
  /** The strip the answer names, null (none), or "keep" (loading, stale, connection states: leave things as they are). */
  autoTarget: StripId | null | "keep";
  /** The opened strip's detail starts with this, so a clamped answer is never lost (R3). */
  detailLead: string | null;
  writes: { id: WriteId; enabled: boolean; reason: string | null }[];
  /** The page shows old data: every write is off. */
  stale: boolean;
}

/** Status polls every 10 s, so three polls. */
const STALE_MS = 30_000;
export const POLL_S = 10;
const PAUSED = "Controls are paused while the page shows old data.";
const ONE_JOB = "Hermes runs one job at a time.";
const CONNECTION = { name: "Hermes", place: "Settings → Access", href: "/settings#access", paused: "Status, runs and ask", retryS: POLL_S };
const TITLES: Record<StripId, string> = { loops: "Loops", runs: "Runs", ask: "Ask", activity: "Activity" };
const ALL_WRITES: WriteId[] = ["run-digest", "test-alert", "ask"];

export const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** First line of an upstream error, short, with any address redacted. */
const firstLine = (s: string | null) =>
  (s ?? "").split(/\r?\n/)[0].trim().replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?/g, "an address").replace(/\.$/, "").slice(0, 160);

const inScope = (scope: "runs" | "ask", kind: HermesJobKind | null) => (scope === "ask" ? kind === "ask" : kind === "digest" || kind === "alert-test");

/** R19/C20: what the Runs detail or the Ask detail may show of the one slot, filtered by job kind. */
export function jobFor(scope: "runs" | "ask", run: RunInput): { job: HermesJob | null; problem: string | null } {
  const job = run.job?.ok && inScope(scope, run.job.job.kind) ? run.job.job : null;
  let problem: string | null = null;
  if (scope === "ask" && run.kind === "ask" && run.startError) problem = run.startError;
  else if (run.job && !run.job.ok && inScope(scope, run.kind)) problem = "Couldn’t read the job’s result.";
  return { job, problem };
}

const off = (): Model["writes"] => ALL_WRITES.map((id) => ({ id, enabled: false, reason: null }));
const head = (c: ReturnType<typeof connectionHead>): Model => ({
  chip: c.chip, answer: c.answer, evidence: c.evidence, notice: null, link: c.link, strips: [], autoTarget: c.autoTarget, detailLead: null, writes: off(), stale: false,
});

const nextText = (iso: string | null, now: number) => {
  const ms = iso ? Date.parse(iso) - now : NaN;
  if (!Number.isFinite(ms)) return null;
  return ms <= 30_000 ? "due now" : `in ${ageText(ms)}`;
};

export function hermesModel(i: ModelInput): Model {
  const { status, now, run } = i;
  if (!status) return head(connectionHead(CONNECTION, i.loadError ? "error" : "loading"));
  if (status.status !== "ok") return head(connectionHead(CONNECTION, status.status));

  const s: HermesStatusOk = status;
  const age = i.lastOkAt === null ? 0 : Math.max(0, now - i.lastOkAt);
  const stale = i.loadError || age > STALE_MS;
  const ago = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? ` ${ageText(Math.max(0, now - Date.parse(iso)))} ago` : "");

  // ---- the one slot (R19) ----
  const runJob = jobFor("runs", run).job;
  const askJob = jobFor("ask", run).job;
  const pending = run.starting || (Boolean(run.jobId) && !run.job);
  const busy = pending || (run.job?.ok === true && run.job.job.state === "running");
  const elapsed = (j: HermesJob | null) => {
    const ms = j?.startedAt ? now - Date.parse(j.startedAt) : NaN;
    return Number.isFinite(ms) ? ` · ${formatElapsed(ms)}` : "";
  };
  const runsRunning = runJob?.state === "running" || (pending && inScope("runs", run.kind));
  const askRunning = askJob?.state === "running" || (pending && run.kind === "ask");
  const runLabel = (runJob?.kind ?? run.kind) === "alert-test" ? "Test alert" : "Digest";
  const runFailed = runJob?.state === "error";

  // ---- facts ----
  const failedLoop = (["collect", "digest"] as const).find((k) => s.loops[k].lastOk === false);
  const unhealthy = !failedLoop && !s.ok;
  const next = nextText(s.loops.digest.nextRunAt, now);
  const alerts = s.counts.alerts24h;
  const calm =
    `Hermes is running on ${s.tier.model}. ${next ? `Next digest ${next}` : "No digest is scheduled"}; ` +
    `${alerts === 0 ? "no alerts" : `${alerts} ${alerts === 1 ? "alert" : "alerts"}`} in the last 24 h.` +
    (s.dryRun ? " Dry run: nothing is posted to Discord." : "");

  let chip: Model["chip"] = { tone: "ok", label: "Running" };
  let answer = calm;
  if (failedLoop) {
    const loop = s.loops[failedLoop];
    const why = firstLine(loop.lastError);
    chip = { tone: "bad", label: "Loop failing" };
    answer = `Hermes’s ${failedLoop} loop failed${ago(loop.lastRunAt)}${why ? `: ${why}` : ""}.`;
  } else if (unhealthy) {
    chip = { tone: "warn", label: "Unhealthy" };
    answer = "Hermes is up but reports itself unhealthy.";
  }
  let evidence = `Updated ${ageText(age)} ago · checks every ${POLL_S} s`;
  let notice: string | null = null;
  let autoTarget: Model["autoTarget"] = failedLoop || unhealthy ? "loops" : runFailed ? "runs" : null;
  if (stale) {
    chip = { tone: "neutral", label: "Stale" };
    answer = `Showing what was true ${ageText(age)} ago: ${answer}`;
    evidence = `Last update ${ageText(age)} ago · Hermes stopped answering`;
    notice = PAUSED;
    autoTarget = "keep";
  }

  // ---- strips ----
  const digestFailed = failedLoop ? `${failedLoop === "digest" ? "Digest" : "Collect"} failed${ago(s.loops[failedLoop].lastRunAt)}` : null;
  const loopsState = digestFailed ?? (unhealthy ? "Unhealthy" : `3 loops OK${s.startedAt ? ` · up ${ageText(Math.max(0, now - Date.parse(s.startedAt)))}` : ""}`);
  const items = i.activity?.status === "ok" ? i.activity.items : null;
  const strips: Strip[] = [
    { id: "loops", title: TITLES.loops, state: loopsState + (s.dryRun ? " · dry run" : ""), tone: failedLoop ? "bad" : unhealthy ? "warn" : null },
    {
      id: "runs", title: TITLES.runs, tone: !runsRunning && runFailed ? "bad" : null,
      state: runsRunning
        ? runJob?.state === "running" ? `${runLabel} running${elapsed(runJob)}` : `${runLabel} starting`
        : runFailed ? `Last run failed${runJob?.error && firstLine(failedRunText(runJob.error)) ? `: ${firstLine(failedRunText(runJob.error))}` : ""}` : next ? `Next digest ${next}` : "No digest scheduled",
    },
    { id: "ask", title: TITLES.ask, tone: null, state: askRunning ? `Answering${elapsed(askJob)}` : `${s.tier.tier} tier · ready` },
    {
      id: "activity", title: TITLES.activity, tone: null,
      state: !i.activity ? "Loading…" : !items ? "Unavailable" : items.length === 0 ? "Nothing yet" : `Last: ${items[0].title || "(no title)"} · ${ageText(Math.max(0, now - Date.parse(items[0].at)))} ago`,
    },
  ];

  // ---- writes; stale turns every write off, then the one-job slot ----
  const why = stale ? PAUSED : busy ? ONE_JOB : null;
  const writes: Model["writes"] = ALL_WRITES.map((id) => ({ id, enabled: why === null, reason: why }));
  return {
    chip, answer, evidence, notice, link: null, strips, autoTarget, writes, stale,
    detailLead: autoTarget === "loops" ? answer : null,
  };
}
