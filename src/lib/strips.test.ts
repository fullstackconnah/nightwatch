import test from "node:test";
import assert from "node:assert/strict";
import { heldRows, nextOpen, type OpenState } from "./strips.ts";

const none: OpenState = { open: null, by: null };
const person = (open: string): OpenState => ({ open, by: "person" });

test("C6: a named target opens by itself", () => {
  assert.deepEqual(nextOpen(none, "server", false), { open: "server", by: "auto" });
  assert.deepEqual(nextOpen(none, "pack", true), { open: "pack", by: "auto" });
});
test("C6: calm opens nothing at 390 and Server at 1440", () => {
  assert.deepEqual(nextOpen(none, null, false), none);
  assert.deepEqual(nextOpen(none, null, true), { open: "server", by: "auto" });
});
test("C6: stale and loading ('keep') leave the open strip alone; 1440 still gets Server", () => {
  const auto: OpenState = { open: "pack", by: "auto" };
  assert.deepEqual(nextOpen(auto, "keep", false), auto);
  assert.deepEqual(nextOpen(none, "keep", false), none);
  assert.deepEqual(nextOpen(none, "keep", true), { open: "server", by: "auto" });
});
test("C6: a person's strip is never closed or replaced by any target", () => {
  for (const target of ["server", "pack", null, "keep"] as const) {
    for (const wide of [false, true]) assert.deepEqual(nextOpen(person("players"), target, wide), person("players"));
  }
});
test("C6: an auto-opened strip closes when the subject goes calm at 390, and retargets otherwise", () => {
  const auto: OpenState = { open: "server", by: "auto" };
  assert.deepEqual(nextOpen(auto, null, false), none);
  assert.deepEqual(nextOpen(auto, "pack", false), { open: "pack", by: "auto" });
});

test("C7: while held, a new row waits and a row that left stays in its slot", () => {
  const h = heldRows(["a", "b"], ["b", "c"], true);
  assert.deepEqual(h.rows, ["a", "b"]);
  assert.deepEqual([...h.gone], ["a"]);
  assert.equal(h.waiting, 1);
  assert.equal(h.pill, "1 new · show");
});
test("C7: not held (or first paint) commits the live rows and the pill is empty", () => {
  assert.deepEqual(heldRows(["a", "b"], ["b", "c"], false).rows, ["b", "c"]);
  assert.deepEqual(heldRows(null, ["a"], true).rows, ["a"]);
  assert.equal(heldRows(["a"], ["a"], true).pill, "");
});
