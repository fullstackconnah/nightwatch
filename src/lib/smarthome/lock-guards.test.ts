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
  assert.match(src, /setTimeout\(\(\) => setPhase\("idle"\), autoCancelMs\)/);
  assert.match(src, /phase !== "failed"/);
  assert.match(src, /autoCancelMs \? setPhase\("asking"\) : void go\(\)/);
  assert.match(src, /autoFocus=\{!!autoCancelMs\}/);
  assert.match(src, /autoFocus=\{!autoCancelMs\}/);
});
