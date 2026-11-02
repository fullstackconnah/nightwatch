import test from "node:test";
import assert from "node:assert/strict";
import { backupReason } from "./mc-backup-reason.ts";

test("reason explains whichever action is disabled", () => {
  assert.equal(backupReason("running"), "Stop the server to restore.");
  assert.equal(backupReason("exited"), "Start the server to back up.");
});
test("no reason while the container state is still loading", () => {
  assert.equal(backupReason(undefined), null);
});
