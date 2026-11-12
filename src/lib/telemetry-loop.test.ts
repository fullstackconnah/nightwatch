import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loopStep, nextDelayMs } from "./telemetry-loop.ts";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("decision 1: live ticks at the live cadence, idle ticks wait the full history interval", () => {
  assert.equal(nextDelayMs({ subscribers: 1, elapsedMs: 200, liveMs: 1000, idleMs: 30_000 }), 800);
  assert.equal(nextDelayMs({ subscribers: 1, elapsedMs: 5000, liveMs: 1000, idleMs: 30_000 }), 0);
  // Full interval (not minus elapsed) so consecutive idle timestamps are never under 30 s apart and skipped.
  assert.equal(nextDelayMs({ subscribers: 0, elapsedMs: 200, liveMs: 1000, idleMs: 30_000 }), 30_000);
});

test("decision 4: idle ticks do not feed the ring; live to idle clears it", () => {
  assert.deepEqual(loopStep({ subscribers: 0, wasLive: false }), { feedRing: false, resetRates: false, clearRing: false });
  assert.deepEqual(loopStep({ subscribers: 0, wasLive: true }), { feedRing: false, resetRates: false, clearRing: true });
  assert.equal(loopStep({ subscribers: 2, wasLive: true }).feedRing, true);
});

test("decision 6: idle to live resets rates; idle to idle and live to live do not", () => {
  assert.equal(loopStep({ subscribers: 1, wasLive: false }).resetRates, true);
  assert.equal(loopStep({ subscribers: 0, wasLive: false }).resetRates, false);
  assert.equal(loopStep({ subscribers: 1, wasLive: true }).resetRates, false);
});

test("decision 2 and 5: one running guard for boot and subscribe; the idle sleep is wakeable", () => {
  const t = src("./telemetry.ts");
  assert.equal((t.match(/void loop\(\)/g) ?? []).length, 1, "a single place starts the loop");
  assert.match(t, /export function startTelemetryRecorder\(\): void \{\s*ensureLoop\(\);/);
  assert.match(t, /subs\.add\(cb\);\s*ensureLoop\(\);\s*wakeLoop\(\);/);
  assert.ok(t.includes("if (ms > TARGET_MS) globalForTelemetry.__telemetryWake = done;"), "a live sleep is never cut short");
  assert.match(t, /function ensureLoop\(\)[\s\S]*if \(!globalForTelemetry\.__telemetryRunning\)/);
});

test("decision 3: instrumentation starts the recorder only on the node runtime", () => {
  const i = src("../instrumentation.ts");
  assert.match(i, /process\.env\.NEXT_RUNTIME === "nodejs"/);
  assert.match(i, /import\("@\/lib\/telemetry"\)/);
  assert.match(i, /startTelemetryRecorder\(\)/);
});
