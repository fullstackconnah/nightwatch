import test from "node:test";
import assert from "node:assert/strict";
import type { HermesActivityResponse, HermesJob, HermesStatusOk, HermesStatusResponse } from "../types/hermes.ts";
import { hermesModel, jobFor, type Model, type ModelInput, type RunInput, type WriteId } from "./page-model.ts";

const NOW = Date.parse("2026-11-06T10:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const H = 3_600_000;
const okStatus = (o: Partial<HermesStatusOk> = {}): HermesStatusOk => ({
  status: "ok", ok: true, startedAt: iso(-3 * 24 * H), tier: { tier: "local", model: "qwen-test", source: "env" }, dryRun: false,
  loops: {
    collect: { lastRunAt: iso(-5 * 60_000), lastOk: true, lastError: null },
    digest: { lastRunAt: iso(-2 * H), lastOk: true, lastError: null, nextRunAt: iso(3 * H) },
    alert: { lastTriggeredAt: iso(-H) },
  },
  discord: { webhookConfigured: true, commandsEnabled: true }, counts: { snapshots24h: 120, alerts24h: 2 }, ...o,
});
const activityOk: HermesActivityResponse = { status: "ok", items: [{ at: iso(-2 * H), kind: "digest", title: "Morning digest", body: "All quiet." }] };
const idle: RunInput = { starting: false, kind: null, job: undefined, startError: null };
const job = (o: Partial<HermesJob>): RunInput["job"] => ({
  ok: true, job: { state: "running", kind: "digest", startedAt: iso(-42_000), finishedAt: null, result: null, error: null, ...o },
});
function input(o: Partial<ModelInput> = {}): ModelInput {
  return { status: okStatus(), activity: activityOk, loadError: false, run: idle, lastOkAt: NOW - 4000, now: NOW, ...o };
}
const w = (m: Model, id: WriteId) => m.writes.find((x) => x.id === id)!;
const enabled = (m: Model) => m.writes.filter((x) => x.enabled).map((x) => x.id).sort();
const strip = (m: Model, id: string) => m.strips.find((s) => s.id === id)!;
const PAUSED = "Controls are paused while the page shows old data.";
const ONE = "Hermes runs one job at a time.";
const ALL = ["ask", "run-digest", "test-alert"];

test("loading: Checking, no strips, nothing writable, nothing opens", () => {
  const m = hermesModel(input({ status: undefined, lastOkAt: null }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Checking" });
  assert.equal(m.answer, "Connecting to Hermes…");
  assert.deepEqual(m.strips, []);
  assert.deepEqual(enabled(m), []);
  assert.equal(m.autoTarget, "keep");
});

test("load error with no data: No answer, no strips", () => {
  const m = hermesModel(input({ status: undefined, loadError: true, lastOkAt: null }));
  assert.equal(m.chip.label, "No answer");
  assert.deepEqual(m.strips, []);
  assert.deepEqual(enabled(m), []);
});

test("unconfigured, unauthorized, unreachable: connection head, link, no strips, writes off", () => {
  const cases: [HermesStatusResponse, string, string][] = [
    [{ status: "unconfigured", detail: "x" }, "Not connected", "Hermes isn’t connected yet."],
    [{ status: "unauthorized", detail: "401 from 10.1.2.3" }, "Token rejected", "Hermes rejected the token. Check it in Settings → Access."],
    [{ status: "unreachable", detail: "connect ECONNREFUSED 10.1.2.3:8722" }, "Not answering", "Hermes isn’t answering. Status, runs and ask are paused until it’s back."],
  ];
  for (const [status, chip, answer] of cases) {
    const m = hermesModel(input({ status }));
    assert.equal(m.chip.label, chip);
    assert.equal(m.answer, answer);
    assert.deepEqual(m.strips, []);
    assert.deepEqual(enabled(m), []);
    assert.equal(m.autoTarget, "keep");
    assert.doesNotMatch(JSON.stringify(m), /10\.1\.2\.3|ECONNREFUSED|401 from/);
  }
  assert.equal(hermesModel(input({ status: { status: "unconfigured", detail: "" } })).link?.href, "/settings#access");
});

test("calm: Running, one-line answer, four strips in order, all writes on, nothing opens", () => {
  const m = hermesModel(input());
  assert.deepEqual(m.chip, { tone: "ok", label: "Running" });
  assert.equal(m.answer, "Hermes is running on qwen-test. Next digest in 3 h; 2 alerts in the last 24 h.");
  assert.deepEqual(m.strips.map((s) => s.id), ["loops", "runs", "ask", "activity"]);
  assert.equal(strip(m, "loops").state, "3 loops OK · up 3 d");
  assert.equal(strip(m, "runs").state, "Next digest in 3 h");
  assert.equal(strip(m, "ask").state, "local tier · ready");
  assert.equal(strip(m, "activity").state, "Last: Morning digest · 2 h ago");
  assert.ok(m.strips.every((s) => s.tone === null));
  assert.deepEqual(enabled(m), ALL);
  assert.equal(m.autoTarget, null);
  assert.equal(m.notice, null);
  assert.equal(m.stale, false);
});

test("calm with no alerts and no digest scheduled", () => {
  const s = okStatus({ counts: { snapshots24h: 1, alerts24h: 0 } });
  s.loops.digest.nextRunAt = null;
  assert.equal(hermesModel(input({ status: s })).answer, "Hermes is running on qwen-test. No digest is scheduled; no alerts in the last 24 h.");
  assert.equal(hermesModel(input({ status: okStatus({ counts: { snapshots24h: 1, alerts24h: 1 } }) })).answer, "Hermes is running on qwen-test. Next digest in 3 h; 1 alert in the last 24 h.");
});

test("dry run: still Running, the answer says nothing is posted, the Loops line says dry run", () => {
  const m = hermesModel(input({ status: okStatus({ dryRun: true }) }));
  assert.deepEqual(m.chip, { tone: "ok", label: "Running" });
  assert.ok(m.answer.endsWith(" Dry run: nothing is posted to Discord."));
  assert.equal(strip(m, "loops").state, "3 loops OK · up 3 d · dry run");
  assert.equal(strip(m, "loops").tone, null);
  assert.equal(m.autoTarget, null);
});

test("a loop failed: bad chip, the loop and its first error line, Loops opens with the answer", () => {
  const s = okStatus();
  s.loops.digest = { ...s.loops.digest, lastOk: false, lastError: "model timed out\nstack line 2" };
  const m = hermesModel(input({ status: s }));
  assert.deepEqual(m.chip, { tone: "bad", label: "Loop failing" });
  assert.equal(m.answer, "Hermes’s digest loop failed 2 h ago: model timed out.");
  assert.equal(strip(m, "loops").state, "Digest failed 2 h ago");
  assert.equal(strip(m, "loops").tone, "bad");
  assert.equal(m.autoTarget, "loops");
  assert.equal(m.detailLead, m.answer);
  assert.deepEqual(enabled(m), ALL);
});

test("the first failed loop in collect, digest order is named; an address in the error is redacted", () => {
  const s = okStatus();
  s.loops.collect = { lastRunAt: iso(-60_000), lastOk: false, lastError: "connect to 10.9.8.7:2375 refused" };
  s.loops.digest = { ...s.loops.digest, lastOk: false, lastError: "other" };
  const m = hermesModel(input({ status: s }));
  assert.match(m.answer, /^Hermes’s collect loop failed 1 min ago: connect to an address refused\.$/);
  assert.doesNotMatch(m.answer, /10\.9\.8\.7/);
});

test("ok false with no failed loop: warn Unhealthy; a failed loop outranks it", () => {
  const m = hermesModel(input({ status: okStatus({ ok: false }) }));
  assert.deepEqual(m.chip, { tone: "warn", label: "Unhealthy" });
  assert.equal(m.answer, "Hermes is up but reports itself unhealthy.");
  assert.equal(strip(m, "loops").state, "Unhealthy");
  assert.equal(strip(m, "loops").tone, "warn");
  assert.equal(m.autoTarget, "loops");
  const s = okStatus({ ok: false });
  s.loops.collect.lastOk = false;
  assert.equal(hermesModel(input({ status: s })).chip.tone, "bad");
});

test("job running: head unchanged, Runs line ticks, all three writes off with the one-job reason", () => {
  const calm = hermesModel(input());
  const m = hermesModel(input({ run: { ...idle, kind: "digest", job: job({}) } }));
  assert.equal(m.answer, calm.answer);
  assert.deepEqual(m.chip, calm.chip);
  assert.equal(m.autoTarget, null);
  assert.equal(strip(m, "runs").state, "Digest running · 0:42");
  assert.deepEqual(enabled(m), []);
  for (const id of ["run-digest", "test-alert", "ask"] as const) assert.equal(w(m, id).reason, ONE);
});

test("starting counts as a running job", () => {
  const m = hermesModel(input({ run: { ...idle, kind: "alert-test", starting: true } }));
  assert.deepEqual(enabled(m), []);
  assert.equal(strip(m, "runs").state, "Test alert starting");
});

test("job id set but the job not fetched yet is still busy: every write off, a job is running", () => {
  const m = hermesModel(input({ run: { ...idle, kind: "digest", jobId: "job-1" } }));
  assert.deepEqual(enabled(m), []);
  for (const id of ALL) assert.equal(w(m, id as WriteId).reason, ONE);
  assert.equal(strip(m, "runs").state, "Digest starting");
});

test("an ask running shows in Ask, not Runs; a digest never shows in Ask", () => {
  const m = hermesModel(input({ run: { ...idle, kind: "ask", job: job({ kind: "ask", startedAt: iso(-12_000) }) } }));
  assert.equal(strip(m, "ask").state, "Answering · 0:12");
  assert.equal(strip(m, "runs").state, "Next digest in 3 h");
  assert.deepEqual(enabled(m), []);
  const d = hermesModel(input({ run: { ...idle, kind: "digest", job: job({}) } }));
  assert.equal(strip(d, "ask").state, "local tier · ready");
});

test("C20: results are filtered by kind", () => {
  const done = (kind: HermesJob["kind"]): RunInput => ({ ...idle, kind, job: job({ kind, state: "done", result: { title: "T", body: "B" } }) });
  assert.equal(jobFor("runs", done("digest")).job?.result?.title, "T");
  assert.equal(jobFor("runs", done("alert-test")).job?.result?.title, "T");
  assert.equal(jobFor("runs", done("ask")).job, null);
  assert.equal(jobFor("ask", done("ask")).job?.result?.body, "B");
  assert.equal(jobFor("ask", done("digest")).job, null);
  assert.equal(jobFor("runs", done("summarize")).job, null);
  assert.equal(jobFor("ask", done("summarize")).job, null);
});

test("a job that cannot be read gets plain words, no upstream detail; a failed ask start passes its text through", () => {
  const bad: RunInput = { ...idle, kind: "ask", job: { ok: false, status: "unreachable", detail: "connect ECONNREFUSED 10.1.2.3" } };
  assert.equal(jobFor("ask", bad).problem, "Couldn’t read the job’s result.");
  assert.equal(jobFor("runs", bad).problem, null);
  assert.equal(jobFor("ask", { ...idle, kind: "ask", startError: "Hermes is already running a job." }).problem, "Hermes is already running a job.");
  assert.equal(jobFor("runs", { ...idle, kind: "digest", startError: "x" }).problem, null);
});

test("run done: head unchanged, writes back on", () => {
  const m = hermesModel(input({ run: { ...idle, kind: "digest", job: job({ state: "done", result: { title: "T", body: "B" }, finishedAt: iso(-1000) }) } }));
  assert.deepEqual(enabled(m), ALL);
  assert.equal(strip(m, "runs").state, "Next digest in 3 h");
  assert.equal(m.autoTarget, null);
});

test("last run failed: Runs line bad with the first error line, Runs opens, head unchanged", () => {
  const calm = hermesModel(input());
  const m = hermesModel(input({ run: { ...idle, kind: "alert-test", job: job({ kind: "alert-test", state: "error", error: "webhook said no\nmore" }) } }));
  assert.equal(strip(m, "runs").state, "Last run failed: webhook said no");
  assert.equal(strip(m, "runs").tone, "bad");
  assert.equal(m.autoTarget, "runs");
  assert.equal(m.answer, calm.answer);
  assert.deepEqual(m.chip, calm.chip);
  assert.deepEqual(enabled(m), ALL);
  const noText = hermesModel(input({ run: { ...idle, kind: "digest", job: job({ state: "error", error: null }) } }));
  assert.equal(strip(noText, "runs").state, "Last run failed");
});

test("a failed ask does not mark the Runs strip", () => {
  const m = hermesModel(input({ run: { ...idle, kind: "ask", job: job({ kind: "ask", state: "error", error: "no" }) } }));
  assert.equal(strip(m, "runs").tone, null);
  assert.equal(m.autoTarget, null);
});

test("a failed loop outranks a failed run for the open strip", () => {
  const s = okStatus();
  s.loops.digest.lastOk = false;
  const m = hermesModel(input({ status: s, run: { ...idle, kind: "digest", job: job({ state: "error", error: "x" }) } }));
  assert.equal(m.autoTarget, "loops");
});

test("stale after a failed poll: neutral chip, the calm answer 'showing', notice, every write off, nothing opens", () => {
  const calm = hermesModel(input());
  const m = hermesModel(input({ loadError: true, lastOkAt: NOW - 40_000 }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Stale" });
  assert.equal(m.answer, `Showing what was true 40 s ago: ${calm.answer}`);
  assert.equal(m.notice, PAUSED);
  assert.equal(m.stale, true);
  assert.deepEqual(enabled(m), []);
  for (const id of ["run-digest", "test-alert", "ask"] as const) assert.equal(w(m, id).reason, PAUSED);
  assert.equal(m.autoTarget, "keep");
  assert.doesNotMatch(m.chip.label + m.answer, /^Running|All clear|All up/);
});

test("stale when the last good answer is older than three polls (30 s) even without an error", () => {
  assert.equal(hermesModel(input({ lastOkAt: NOW - 31_000 })).stale, true);
  assert.equal(hermesModel(input({ lastOkAt: NOW - 29_000 })).stale, false);
});

test("stale wins over a running job's reason", () => {
  const m = hermesModel(input({ loadError: true, run: { ...idle, kind: "digest", job: job({}) } }));
  assert.equal(w(m, "run-digest").reason, PAUSED);
});

test("activity line: nothing yet, loading, unavailable", () => {
  assert.equal(strip(hermesModel(input({ activity: { status: "ok", items: [] } })), "activity").state, "Nothing yet");
  assert.equal(strip(hermesModel(input({ activity: undefined })), "activity").state, "Loading…");
  assert.equal(strip(hermesModel(input({ activity: { status: "unreachable", detail: "10.0.0.1" } })), "activity").state, "Unavailable");
});

test("the Loops line never reads dry run into the tone, and the strip ids are unique and fixed", () => {
  const m = hermesModel(input());
  assert.equal(new Set(m.strips.map((s) => s.id)).size, 4);
});

test("last run failed: the Runs strip redacts a credential in the error", () => {
  const m = hermesModel(input({ run: { ...idle, kind: "digest", job: job({ state: "error", error: "boom password=hunter2" }) } }));
  assert.ok(strip(m, "runs").state.startsWith("Last run failed: boom"));
  assert.ok(!strip(m, "runs").state.includes("hunter2"));
});
