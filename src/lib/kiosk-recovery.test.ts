import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { planRecovery, RESET_DELAY_MS, WINDOW_MS } from "./kiosk-recovery.ts";

const NOW = 10_000_000;
const recent = [NOW - 3000, NOW - 2000, NOW - 1000];

test("no attempts: retrying in 10 s", () => {
  const p = planRecovery({ attempts: [], escalatedAt: null }, NOW);
  assert.equal(p.phase, "retrying");
  assert.equal(p.delayMs, RESET_DELAY_MS);
});

test("3 recent attempts, no escalation: escalating in 10 s", () => {
  const p = planRecovery({ attempts: recent, escalatedAt: null }, NOW);
  assert.equal(p.phase, "escalating");
  assert.equal(p.delayMs, RESET_DELAY_MS);
  assert.deepEqual(p.recentAttempts, recent);
});

test("escalated 60 s ago: stuck, reload just after the window", () => {
  const p = planRecovery({ attempts: recent, escalatedAt: NOW - 60_000 }, NOW);
  assert.equal(p.phase, "stuck");
  assert.equal(p.delayMs, WINDOW_MS - 60_000 + 1000);
});

test("attempts and escalation older than the window: fresh ladder", () => {
  const old = NOW - WINDOW_MS - 1;
  const p = planRecovery({ attempts: [old, old, old], escalatedAt: old }, NOW);
  assert.equal(p.phase, "retrying");
  assert.deepEqual(p.recentAttempts, []);
});

test("escalation 1 ms short of the window end: delay at least 10 s", () => {
  const p = planRecovery({ attempts: recent, escalatedAt: NOW - WINDOW_MS + 1 }, NOW);
  assert.equal(p.phase, "stuck");
  assert.ok(p.delayMs >= RESET_DELAY_MS);
});

const src = readFileSync(
  fileURLToPath(new URL("../app/kiosk/error.tsx", import.meta.url)),
  "utf8",
);

test("error.tsx plans through the helper and reloads from a timer when stuck", () => {
  assert.match(src, /planRecovery\(/);
  assert.match(src, /setTimeout\(\(\) => window\.location\.reload\(\), /);
  assert.doesNotMatch(src, /^const (RESET_DELAY_MS|MAX_AUTO_ATTEMPTS|WINDOW_MS) =/m);
});
