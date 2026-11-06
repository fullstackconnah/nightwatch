import assert from "node:assert/strict";
import { test } from "node:test";
import { isClamped } from "./use-answer-clamped.ts";

test("the answer counts as clamped only when its content is taller than its box (1 px of rounding allowed)", () => {
  assert.equal(isClamped(44, 44), false);
  assert.equal(isClamped(45, 44), false);
  assert.equal(isClamped(46, 44), true);
  assert.equal(isClamped(66, 44), true);
});
