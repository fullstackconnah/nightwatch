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
