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
  "/var",
  "/usr",
  "/home/x",
  "/mnt",
  "/opt/x",
  "/mnt/docker",
  "/mnt/docker/stacks/../../etc",
  "../x",
  "/etcetera",
  "/rootfs",
  "/var/lib/dockerx",
  "/var/lib/other",
  "/mnt/../srv/data",
];
for (const host of refusedBinds) {
  test(`refuses bind ${JSON.stringify(host)}`, () => {
    assert.equal(typeof validateCreateSpec(spec(host)), "string");
  });
}

const allowedBinds = [
  "/mnt/docker/stacks/x",
  "/mnt/docker/stacks/app/data",
  "/mnt/media",
  "/mnt/media/",
  "/mnt/media/films",
  "app_data",
  "My-vol.1",
];
for (const host of allowedBinds) {
  test(`allows bind ${host}`, () => {
    assert.equal(validateCreateSpec(spec(host)), null);
  });
}

test("refuses odd named volumes", () => {
  for (const host of ["-x", ".x", "a b", "a:b", "a/b"]) {
    assert.equal(typeof validateCreateSpec(spec(host)), "string", host);
  }
});

test("refusal names the allowed roots", () => {
  assert.equal(
    validateCreateSpec(spec("/var")),
    'Mounting "/var" is not allowed. Bind mounts must be under: /mnt/docker/stacks, /mnt/media.',
  );
});

test("CREATE_BIND_ROOTS overrides the default; / and protected roots are ignored", () => {
  const old = process.env.CREATE_BIND_ROOTS;
  process.env.CREATE_BIND_ROOTS = "/srv/a,/,/etc,/var/run/";
  try {
    assert.equal(validateCreateSpec(spec("/srv/a/x")), null);
    assert.equal(typeof validateCreateSpec(spec("/etc")), "string");
    assert.equal(typeof validateCreateSpec(spec("/mnt/media")), "string");
    assert.equal(typeof validateCreateSpec(spec("/")), "string");
    assert.equal(typeof validateCreateSpec(spec("/var/run/docker.sock")), "string");
  } finally {
    if (old === undefined) delete process.env.CREATE_BIND_ROOTS;
    else process.env.CREATE_BIND_ROOTS = old;
  }
});

test("refuses network host and container:", () => {
  assert.equal(typeof validateCreateSpec(spec("/mnt/media/a", "host")), "string");
  assert.equal(typeof validateCreateSpec(spec("/mnt/media/a", "container:abc")), "string");
});

test("allows bridge, named and blank networks", () => {
  for (const n of ["bridge", "homelab_default", "hostnet", "", undefined]) {
    assert.equal(validateCreateSpec(spec("/mnt/media/a", n)), null);
  }
});

test("rows with a blank host or container path are ignored like the create call does", () => {
  const s = { ...spec("/mnt/media/a"), volumes: [{ host: "", container: "" }] };
  assert.equal(validateCreateSpec(s), null);
});
