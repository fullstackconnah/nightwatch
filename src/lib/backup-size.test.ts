import test from "node:test";
import assert from "node:assert/strict";
import { backupSizeText } from "./backup-size.ts";

test("backupSizeText: a finite size prints in MB, anything else says unknown", () => {
  assert.equal(backupSizeText(1048576), "1.0 MB");
  assert.equal(backupSizeText(0), "0.0 MB");
  for (const v of [undefined, null, Number.NaN, "12", Infinity]) assert.equal(backupSizeText(v), "size unknown");
});
