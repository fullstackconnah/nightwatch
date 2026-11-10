import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { namesForIds, allResolve } from "./container-names.ts";

const list = [
  { id: "a".repeat(64), name: "alpha" },
  { id: "b".repeat(64), name: "beta" },
];

test("an id outside the first call's set still resolves from the same list", () => {
  assert.equal(namesForIds(list, new Set(["a".repeat(64)])).get("a".repeat(64)), "alpha");
  assert.equal(namesForIds(list, new Set(["b".repeat(64)])).get("b".repeat(64)), "beta");
});

test("a short id prefix resolves, an unknown id does not, and allResolve says so", () => {
  assert.equal(namesForIds(list, new Set(["bbbb"])).get("bbbb"), "beta");
  assert.equal(allResolve(list, new Set(["a".repeat(64)])), true);
  assert.equal(allResolve(list, new Set(["c".repeat(64)])), false);
});

test("processes.ts caches the whole list, not the per-call set", () => {
  const s = readFileSync(fileURLToPath(new URL("./processes.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(s, /for \(const id of pendingContainerIds\)/);
  assert.match(s, /^\s+isValid: \(cached\) => allResolve\(cached, pendingContainerIds\)/m);
});

test("performContainerAction drops the containers memo too", () => {
  const s = readFileSync(fileURLToPath(new URL("./docker.ts", import.meta.url)), "utf8");
  assert.match(s, /await containerAction\(id, action\);\s*\} finally \{\s*runtimesMemo\.invalidate\(\);\s*containersMemo\.invalidate\(\);/);
});
