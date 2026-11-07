import assert from "node:assert/strict";
import { it } from "node:test";
import { highlightRanges } from "./highlight-ranges.ts";

it("^ERROR marks only the start of the line, not a later segment", () => {
  assert.deepEqual(highlightRanges(["ERROR ", "x ERROR"], /^ERROR/), [[[0, 5]], []]);
});

it("a match spanning a colour boundary is marked in both segments", () => {
  assert.deepEqual(highlightRanges(["a", "b"], /ab/), [[[0, 1]], [[0, 1]]]);
});

it("no pattern gives no marks", () => {
  assert.deepEqual(highlightRanges(["a", "b"], null), [[], []]);
  assert.deepEqual(highlightRanges(["a", "b"], undefined), [[], []]);
});

it("an empty match marks nothing and terminates", () => {
  assert.deepEqual(highlightRanges(["abc"], /x*/), [[]]);
});
