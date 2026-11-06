import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryGbError, memoryGbInRange } from "./memory-gb.ts";

test("blank means the server default and is not an error", () => {
  assert.equal(memoryGbError(""), null);
  assert.equal(memoryGbError("   "), null);
});

test("a positive number is fine", () => {
  assert.equal(memoryGbError("6"), null);
  assert.equal(memoryGbError("2.5"), null);
});

test("anything else is an error", () => {
  for (const v of ["abc", "0", "-3", "1e", "Infinity", "NaN"]) assert.match(memoryGbError(v) ?? "", /above 0/, v);
});

test("the cap is 32: 32 is fine, 32.5 and 1e9 are errors", () => {
  assert.equal(memoryGbError("32"), null);
  for (const v of ["32.5", "1e9"]) assert.match(memoryGbError(v) ?? "", /up to 32/, v);
});

test("memoryGbInRange: the server bound is above 0 and at most 32", () => {
  for (const n of [0.5, 32]) assert.equal(memoryGbInRange(n), true, String(n));
  for (const n of [0, -1, 32.5, 1e9, NaN, Infinity]) assert.equal(memoryGbInRange(n), false, String(n));
});
