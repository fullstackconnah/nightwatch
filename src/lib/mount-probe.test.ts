import test from "node:test";
import assert from "node:assert/strict";
import { blockDeviceName, classifyDeviceGone, classifyMountError, probeOne } from "./mount-probe.ts";

for (const code of ["EIO", "ENOTCONN", "ESTALE", "ENODEV", "ENXIO", "TIMEOUT"]) {
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
for (const code of ["ENOENT", "EACCES", "EROFS", undefined, ""]) {
  test(`${String(code)} stays silent`, () => {
    assert.equal(classifyMountError("/mnt/media", code), null);
  });
}

// --- device gone ---
test("block device gone from sysfs is disconnected", () => {
  const v = classifyDeviceGone("/mnt/media", "sdb1", false, null);
  assert.ok(v);
  assert.equal(v.headline, "Drive disconnected: /mnt/media");
  assert.match(v.detail, /sdb1/);
  assert.match(v.detail, /still points at it/);
  assert.ok(v.detail.length <= 140);
});
test("parent disk state offline is disconnected", () => {
  assert.equal(classifyDeviceGone("/mnt/media", "sdb1", true, "offline\n")!.headline, "Drive disconnected: /mnt/media");
});
for (const state of ["running\n", "running", "live\n", null]) {
  test(`device present with state ${JSON.stringify(state)} stays silent`, () => {
    assert.equal(classifyDeviceGone("/mnt/media", "sdb1", true, state), null);
  });
}
test("blockDeviceName keeps only plain /dev/<name> sources", () => {
  assert.equal(blockDeviceName("/dev/sdb1"), "sdb1");
  assert.equal(blockDeviceName("/dev/nvme0n1p2"), "nvme0n1p2");
  assert.equal(blockDeviceName("/dev/mapper/ubuntu--vg-ubuntu--lv"), null);
  assert.equal(blockDeviceName("/dev/root"), null);
  assert.equal(blockDeviceName("tmpfs"), null);
  assert.equal(blockDeviceName(undefined), null);
});

// --- probeOne race + pending guard ---
test("probeOne: never-settling read is TIMEOUT", async () => {
  assert.equal(await probeOne("t-never", () => new Promise(() => {}), 10), "TIMEOUT");
});
test("probeOne: rejecting EIO read is EIO", async () => {
  const err = Object.assign(new Error("io"), { code: "EIO" });
  assert.equal(await probeOne("t-eio", () => Promise.reject(err), 1000), "EIO");
});
test("probeOne: resolving read is ok (undefined)", async () => {
  assert.equal(await probeOne("t-ok", async () => ["a"], 1000), undefined);
});
test("probeOne: a still-pending read is not restarted and reports TIMEOUT", async () => {
  let release!: () => void;
  let calls = 0;
  const read = () => {
    calls++;
    return new Promise<void>((r) => (release = r));
  };
  assert.equal(await probeOne("t-pend", read, 10), "TIMEOUT");
  assert.equal(await probeOne("t-pend", read, 1000), "TIMEOUT");
  assert.equal(calls, 1);
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await probeOne("t-pend", async () => [], 1000), undefined);
});
