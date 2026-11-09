import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

// Source scans: the lock's confirm guards live in two components, so each assertion fails when its guard is removed.
test("SH lock: every WriteAction is auto-cancelling from CONFIRM_WINDOW_MS, never confirm={false}, with the hint in the question", () => {
  const src = read("components", "smarthome", "lock.tsx");
  assert.match(src, /autoCancelMs=\{CONFIRM_WINDOW_MS\}/);
  assert.doesNotMatch(src, /confirm=\{false\}/);
  assert.match(src, /It cancels itself in \$\{CONFIRM_WINDOW_MS \/ 1000\} s\./);
  assert.doesNotMatch(src, /RowError/);
});

test("SH write-action: auto-cancel timer, retry goes back to asking, Cancel takes focus", () => {
  const src = read("components", "strips", "write-action.tsx");
  assert.match(src, /\}, autoCancelMs\);/);
  assert.doesNotMatch(src, /phase !== "failed"/); // a failed write stays until Try again or Dismiss
  assert.match(src, /frame\.current\?\.contains\(document\.activeElement\)/);
  assert.match(src, /autoCancelMs \? setPhase\("asking"\) : void go\(\)/);
  // Each autoFocus is tied to ITS button by label: swapping Cancel and Confirm must go red.
  assert.match(src, /<Button autoFocus [^\n]*>\s*Cancel\s*<\/Button>/);
  assert.match(src, /<Button size="sm" variant=\{danger[^\n]*>\s*\{yes\}\s*<\/Button>/);
});

test("SH write-action: the question line is a live region so the unlock hint is announced", () => {
  assert.match(read("components", "strips", "write-action.tsx"), /<p className="st-say" role="status">\{say\}<\/p>/);
});

test("SH smarthome page: the auto-opened lead note keeps a gap above the first row", () => {
  assert.match(read("app", "(dash)", "smarthome", "page.tsx"), /<p className="st-note mb-3" data-feature="detail-lead">\{detailLead\}/);
});

test("SH strip-list: a wide open id that names no strip falls back to the first strip", () => {
  assert.match(read("components", "strips", "strip-list.tsx"), /ordered\.some\(\(x\) => x\.id === state\.open\)/);
});
