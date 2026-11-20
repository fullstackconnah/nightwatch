import test from "node:test";
import assert from "node:assert/strict";
import { jobView } from "./job-view.ts";
import { ApiError } from "../api-error.ts";

const good = { ok: true, job: { id: "j1", state: "running" } } as never;

test("an error with no data yet becomes a failed fetch", () => {
  assert.deepEqual(jobView(undefined, new ApiError("HTTP 500", 500)), { ok: false, status: "error", detail: "HTTP 500" });
  assert.deepEqual(jobView(undefined, new Error("offline")), { ok: false, status: "error", detail: "offline" });
});
test("a 401 fails even with data", () => {
  assert.equal(jobView(good, new ApiError("unauthorized", 401))?.ok, false);
});
test("a 500 after a good reading keeps the data", () => {
  assert.equal(jobView(good, new ApiError("HTTP 500", 500)), good);
});
test("no error passes the data through", () => {
  assert.equal(jobView(good, undefined), good);
  assert.equal(jobView(undefined, undefined), undefined);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
test("useHermesRun maps the poll through jobView and a 401 stops the retries", () => {
  const src = readFileSync(fileURLToPath(new URL("../use-hermes.ts", import.meta.url)), "utf8");
  assert.match(src, /^\s+const job = useMemo\(\(\) => askDeadline\(jobView\(data, error\), /m);
  assert.match(src, /^\s+shouldRetryOnError: .*401/m);
});

import { ASK_DEADLINE_MS, ASK_TIMEOUT_TEXT, askDeadline } from "./job-view.ts";
import { isAsking, settleExchange } from "../voice-settle.ts";

const T0 = 1_000_000;
const running = { ok: true, job: { state: "running", kind: "ask" } } as never;

test("an ask still running one ms before the cap is returned unchanged", () => {
  assert.equal(askDeadline(running, "ask", T0, T0 + ASK_DEADLINE_MS - 1), running);
});
test("an ask still running at the cap reads as a settled error that frees the exchange", () => {
  const read = askDeadline(running, "ask", T0, T0 + ASK_DEADLINE_MS);
  assert.equal(ASK_TIMEOUT_TEXT, "Hermes has not answered after 10 minutes. Stopped waiting; it may still be working.");
  assert.ok(read?.ok && read.job.state === "error" && read.job.kind === "ask" && read.job.error === ASK_TIMEOUT_TEXT);
  assert.deepEqual(settleExchange(read!), { kind: "error", error: ASK_TIMEOUT_TEXT, keepActive: false });
  assert.equal(isAsking({ starting: false, jobId: "j", job: read }), false);
});
test("the same identical read flips once the clock passes the cap", () => {
  assert.equal(askDeadline(running, "ask", T0, T0 + 1000), running);
  assert.equal(askDeadline(running, "ask", T0, T0 + ASK_DEADLINE_MS + 1000)?.ok && true, true);
  assert.notEqual(askDeadline(running, "ask", T0, T0 + ASK_DEADLINE_MS + 1000), running);
});
test("no read at all after the cap is a timeout too", () => {
  const read = askDeadline(undefined, "ask", T0, T0 + ASK_DEADLINE_MS);
  assert.ok(read?.ok && read.job.error === ASK_TIMEOUT_TEXT);
});
test("other kinds, no start time, and real answers or failures are never rewritten", () => {
  const late = T0 + ASK_DEADLINE_MS * 2;
  assert.equal(askDeadline(running, "digest", T0, late), running);
  assert.equal(askDeadline(running, "ask", null, late), running);
  for (const r of [
    { ok: true, job: { state: "done", kind: "ask" } },
    { ok: true, job: { state: "error", kind: "ask" } },
    { ok: false, status: "error", detail: "x" },
  ] as never[]) assert.equal(askDeadline(r, "ask", T0, late), r);
});
test("useHermesRun arms a timer for the ask deadline and polling stops once it fires", () => {
  const src = readFileSync(fileURLToPath(new URL("../use-hermes.ts", import.meta.url)), "utf8");
  assert.match(src, /setTimeout\(\(\) => setExpiredFor/);
  assert.match(src, /refreshInterval: .*paused \? 0/);
});
