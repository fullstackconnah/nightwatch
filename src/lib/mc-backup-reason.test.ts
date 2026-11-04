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

import { restoreRefusal } from "./mc-backup-reason.ts";
import { readFileSync } from "node:fs";

test("OPEN-P2: restore is refused only while the server runs", () => {
  assert.equal(restoreRefusal("running"), "Stop the server before restoring a backup.");
  assert.equal(restoreRefusal("exited"), null);
  assert.equal(restoreRefusal(undefined), null);
});

test("OPEN-P2: the route answers 409 before it calls restoreBackup, and backup-run stays unguarded", () => {
  const src = readFileSync(new URL("../app/api/minecraft/backups/route.ts", import.meta.url), "utf8");
  const restore = src.slice(src.indexOf('action === "restore"'));
  assert.match(restore, /restoreRefusal\([\s\S]*status: 409[\s\S]*restoreBackup\(/);
  assert.doesNotMatch(src.slice(src.indexOf('action === "run"'), src.indexOf('action === "restore"')), /restoreRefusal/);
});
