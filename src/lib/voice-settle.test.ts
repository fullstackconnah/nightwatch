import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { settleExchange } from "./voice-settle.ts";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("an unreadable poll shows the fixed copy and keeps the exchange active", () => {
  assert.deepEqual(settleExchange({ ok: false, status: "error", detail: "HTTP 502" }), {
    kind: "error",
    error: "Could not read the answer from Hermes — try again.",
    keepActive: true,
  });
});

test("a done job gives its answer", () => {
  assert.deepEqual(settleExchange({ ok: true, job: { state: "done", result: { body: "hi" } } }), { kind: "answer", answer: "hi" });
  assert.deepEqual(settleExchange({ ok: true, job: { state: "done" } }), { kind: "answer", answer: "" });
});

test("a job error settles and clears the exchange", () => {
  assert.deepEqual(settleExchange({ ok: true, job: { state: "error", error: "boom" } }), { kind: "error", error: "boom", keepActive: false });
  assert.deepEqual(settleExchange({ ok: true, job: { state: "error" } }), { kind: "error", error: "Hermes reported an error.", keepActive: false });
});

test("a running job waits", () => {
  assert.deepEqual(settleExchange({ ok: true, job: { state: "running" } }), { kind: "wait" });
});

test("useHermesRun memoises jobView and handleTranscript resets the run", () => {
  assert.match(read("./use-hermes.ts"), /const job = useMemo\(\(\) => jobView\(data, error\), \[data, error\]\);/);
  assert.match(read("./use-voice.ts"), /activeExchangeId\.current = id;[\s\S]{0,200}run\.reset\(\);/);
});

import { isAsking } from "./voice-settle.ts";

test("isAsking covers the start POST, the gap before the first poll, and a running job", () => {
  assert.equal(isAsking({ starting: true, jobId: null, job: undefined }), true);
  assert.equal(isAsking({ starting: false, jobId: "j1", job: undefined }), true);
  assert.equal(isAsking({ starting: false, jobId: "j1", job: { ok: true, job: { state: "running" } } }), true);
  assert.equal(isAsking({ starting: false, jobId: "j1", job: { ok: true, job: { state: "done" } } }), false);
  assert.equal(isAsking({ starting: false, jobId: null, job: undefined }), false);
  assert.equal(isAsking({ starting: false, jobId: undefined, job: undefined }), false);
});

test("use-voice derives state from isAsking and guards handleTranscript while a start is in flight", () => {
  const src = read("./use-voice.ts");
  assert.match(src, /^\s*\? "asking"/m);
  assert.match(src, /isAsking\(run\)/);
  assert.match(src, /^\s*if \(startingRef\.current \|\| isAsking\(runRef\.current\)\) return;/m);
});
