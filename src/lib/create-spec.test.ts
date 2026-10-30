import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCreateSpec } from "./create-spec.ts";

const spec = (host: string, network?: string) => ({
  image: "nginx",
  ports: [],
  env: [],
  volumes: [{ host, container: "/data" }],
  network,
});

const refusedBinds = [
  "/",
  "//",
  "/etc",
  "/etc/passwd",
  "/root/.ssh",
  "/proc",
  "/sys/kernel",
  "/dev/sda",
  "/boot",
  "/var/lib/docker",
  "/var/lib/docker/volumes",
  "/run",
  "/var/run",
  "/var/run/docker.sock",
  "/run/docker.sock",
  "//var//run/docker.sock",
  "/var/run/docker.sock/",
  "/mnt/../etc",
  "/mnt/media/../../etc/shadow",
  "/./etc",
  "/etc/",
  "relative/path",
  "./etc",
];
for (const host of refusedBinds) {
  test(`refuses bind ${JSON.stringify(host)}`, () => {
    assert.equal(typeof validateCreateSpec(spec(host)), "string");
  });
}

const allowedBinds = [
  "/mnt/docker/stacks/x",
  "/mnt/media",
  "/mnt/media/",
  "/etcetera",
  "/rootfs",
  "/var/lib/dockerx",
  "/var/lib/other",
  "/mnt/../srv/data",
];
for (const host of allowedBinds) {
  test(`allows bind ${host}`, () => {
    assert.equal(validateCreateSpec(spec(host)), null);
  });
}

test("refuses network host and container:", () => {
  assert.equal(typeof validateCreateSpec(spec("/mnt/a", "host")), "string");
  assert.equal(typeof validateCreateSpec(spec("/mnt/a", "container:abc")), "string");
});

test("allows bridge, named and blank networks", () => {
  for (const n of ["bridge", "homelab_default", "hostnet", "", undefined]) {
    assert.equal(validateCreateSpec(spec("/mnt/a", n)), null);
  }
});

test("rows with a blank host or container path are ignored like the create call does", () => {
  const s = { ...spec("/mnt/a"), volumes: [{ host: "", container: "" }] };
  assert.equal(validateCreateSpec(s), null);
});
