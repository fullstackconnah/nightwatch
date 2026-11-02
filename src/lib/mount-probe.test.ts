import test from "node:test";
import assert from "node:assert/strict";
import { classifyMountError } from "./mount-probe.ts";

for (const code of ["EIO", "ENOTCONN", "ESTALE", "TIMEOUT"]) {
  test(`${code} is a dead mount`, () => {
    const v = classifyMountError("/mnt/media", code);
    assert.ok(v);
    assert.equal(v.headline, "Drive unreadable: /mnt/media");
    assert.ok(v.detail.length <= 140);
  });
}
test("EIO detail names the code", () => {
  assert.match(classifyMountError("/mnt/media", "EIO")!.detail, /EIO/);
});
for (const code of ["ENOENT", "EACCES", undefined, ""]) {
  test(`${String(code)} stays silent`, () => {
    assert.equal(classifyMountError("/mnt/media", code), null);
  });
}
