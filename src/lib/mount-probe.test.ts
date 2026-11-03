import test from "node:test";
import assert from "node:assert/strict";
import { blockDeviceName, classifyDeviceGone, classifyMountError, probeOne } from "./mount-probe.ts";

for (const code of ["EIO", "ENOTCONN", "ESTALE", "ENODEV", "ENXIO", "TIMEOUT"]) {
  test(`${code} is a dead mount`, () => {
    const v = classifyMountError("/mnt/media", code);
    assert.ok(v);
    assert.equal(v.headline, "Can't read files on /mnt/media");
    assert.equal(v.action, "Restart the server; if it happens again, check the drive's cable.");
    assert.ok(v.detail.length <= 100);
  });
}
test("TIMEOUT detail and the root disk name", () => {
  assert.equal(
    classifyMountError("/mnt/media", "TIMEOUT")!.detail,
    "The drive isn't answering, so files there can't be opened. It may have dropped off.",
  );
  assert.equal(classifyMountError("/", "EIO")!.headline, "Can't read files on the system disk");
});
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
  assert.equal(v.headline, "Drive for /mnt/media disconnected");
  assert.equal(v.detail, "Its drive (sdb1) dropped off, so files there can't be opened until it's back.");
  assert.equal(v.action, "Restart the server, then check the drive's cable.");
  assert.equal(classifyDeviceGone("/", "sda1", false, null)!.headline, "Drive for the system disk disconnected");
});
test("parent disk state offline is disconnected", () => {
  assert.equal(classifyDeviceGone("/mnt/media", "sdb1", true, "offline\n")!.headline, "Drive for /mnt/media disconnected");
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
