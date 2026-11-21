import assert from "node:assert/strict";
import { test } from "node:test";
import { processListErrorText } from "./process-error-text.ts";

test("a filesystem error code is named", () => {
  assert.equal(processListErrorText(Object.assign(new Error("x /proc"), { code: "ENOENT" })), "Could not read the process list (ENOENT).");
  assert.equal(processListErrorText({ code: "EACCES" }), "Could not read the process list (EACCES).");
});
test("anything else stays generic and never leaks the message", () => {
  assert.equal(processListErrorText(new Error("boom /proc/1")), "Could not read the process list.");
  assert.equal(processListErrorText({ code: "enoent" }), "Could not read the process list.");
  assert.equal(processListErrorText({ code: 5 }), "Could not read the process list.");
  assert.equal(processListErrorText(null), "Could not read the process list.");
});
