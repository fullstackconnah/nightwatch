import { test } from "node:test";
import assert from "node:assert/strict";
import { shotsFailed } from "./settings-shots-verdict.mjs";

test("any strictly false record fails, in every run mode", () => {
  assert.equal(shotsFailed({ "S no horizontal scroll": { "390": false, "1440": true } }, false), true);
  assert.equal(shotsFailed({ "L1 x": { "390": false } }, true), true);
});
test("all true passes", () => {
  assert.equal(shotsFailed({ a: { "390": true }, b: { "1440": true } }, false), false);
});
test("strings, numbers and objects never fail by themselves", () => {
  assert.equal(shotsFailed({ "C14 page errors": { all: "none" }, "C3 hits": { "1440": 0 }, "C1": { "390": { ok: true } } }, false), false);
});
test("a FAIL key fails only in a single-section run, as before", () => {
  const r = { FAIL: { "x@390": "crop covered" } };
  assert.equal(shotsFailed(r, true), true);
  assert.equal(shotsFailed(r, false), false);
});
test("an empty record set passes", () => {
  assert.equal(shotsFailed({}, false), false);
  assert.equal(shotsFailed({}, true), false);
});
