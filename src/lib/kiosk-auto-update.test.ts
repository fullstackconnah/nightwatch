import test from "node:test";
import assert from "node:assert/strict";
import { autoUpdateDecision, type AutoUpdateInput } from "./kiosk-auto-update.ts";

const base: AutoUpdateInput = { pageBuild: "a", serverBuild: "b", reloadedFor: null, idleMs: 60_000, overlayOpen: false };

test("a new build, idle, nothing open: reload", () => {
  assert.equal(autoUpdateDecision(base), "reload");
});
test("same build: wait", () => {
  assert.equal(autoUpdateDecision({ ...base, serverBuild: "a" }), "wait");
});
test("already reloaded for this target: wait (loop guard)", () => {
  assert.equal(autoUpdateDecision({ ...base, reloadedFor: "b" }), "wait");
});
test("a different earlier target does not block", () => {
  assert.equal(autoUpdateDecision({ ...base, reloadedFor: "x" }), "reload");
});
test("touched under 30 s ago: wait; exactly 30 s: reload", () => {
  assert.equal(autoUpdateDecision({ ...base, idleMs: 29_999 }), "wait");
  assert.equal(autoUpdateDecision({ ...base, idleMs: 30_000 }), "reload");
});
test("overlay open: wait", () => {
  assert.equal(autoUpdateDecision({ ...base, overlayOpen: true }), "wait");
});
