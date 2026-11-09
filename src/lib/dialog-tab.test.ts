import test from "node:test";
import assert from "node:assert/strict";
import { trapTabTarget } from "./dialog-tab.ts";

test("trapTabTarget wraps only at the ends or when focus is outside", () => {
  assert.equal(trapTabTarget(2, 3, false), 0, "Tab on last goes to first");
  assert.equal(trapTabTarget(0, 3, true), 2, "Shift+Tab on first goes to last");
  assert.equal(trapTabTarget(1, 3, false), null);
  assert.equal(trapTabTarget(1, 3, true), null);
  assert.equal(trapTabTarget(-1, 3, false), 0, "outside: Tab enters at first");
  assert.equal(trapTabTarget(-1, 3, true), 2, "outside: Shift+Tab enters at last");
  assert.equal(trapTabTarget(0, 0, false), null, "nothing focusable");
});
