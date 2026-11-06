import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryGbError } from "./memory-gb.ts";

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
