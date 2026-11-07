import assert from "node:assert/strict";
import { it } from "node:test";
import { highlightRanges } from "./highlight-ranges.ts";

it("^ERROR marks only the start of the line, not a later segment", () => {
  assert.deepEqual(highlightRanges(["ERROR ", "ERROR"], /^ERROR/), [[[0, 5]], []]);
});

it("2000 segments with 2000 matches run in under 100 ms", () => {
  const segs = Array.from({ length: 2000 }, () => "ab");
  const t0 = performance.now();
  const out = highlightRanges(segs, /a/);
  assert.ok(performance.now() - t0 < 100);
  assert.deepEqual(out[1999], [[0, 1]]);
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
