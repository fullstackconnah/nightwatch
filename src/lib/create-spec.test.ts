import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMounts, checkCreateSpecHost, validateCreateSpec } from "./create-spec.ts";

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
    'Mounting "/var" is not allowed. Bind mounts must be under: /mnt/media.',
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

test("allows bridge and blank networks; refuses everything else by default", () => {
  for (const n of ["bridge", "", undefined]) assert.equal(validateCreateSpec(spec("/mnt/media/a", n)), null);
  for (const n of ["homelab-dashboard_internal", "x_internal", "a".repeat(64), "host", "none", "homelab_default"]) {
    assert.equal(typeof validateCreateSpec(spec("/mnt/media/a", n)), "string", n);
  }
});

test("CREATE_NETWORKS extends the network allowlist", () => {
  const old = process.env.CREATE_NETWORKS;
  process.env.CREATE_NETWORKS = "bridge, media_net";
  try {
    assert.equal(validateCreateSpec(spec("/mnt/media/a", "media_net")), null);
    assert.equal(typeof validateCreateSpec(spec("/mnt/media/a", "other_net")), "string");
  } finally {
    if (old === undefined) delete process.env.CREATE_NETWORKS;
    else process.env.CREATE_NETWORKS = old;
  }
});

test("/mnt/docker/stacks is refused by default and allowed when listed", () => {
  assert.equal(typeof validateCreateSpec(spec("/mnt/docker/stacks/x")), "string");
  const old = process.env.CREATE_BIND_ROOTS;
  process.env.CREATE_BIND_ROOTS = "/mnt/docker/stacks";
  try {
    assert.equal(validateCreateSpec(spec("/mnt/docker/stacks/x")), null);
  } finally {
    if (old === undefined) delete process.env.CREATE_BIND_ROOTS;
    else process.env.CREATE_BIND_ROOTS = old;
  }
});

test("rows with a blank host or container path are ignored like the create call does", () => {
  const s = { ...spec("/mnt/media/a"), volumes: [{ host: "", container: "" }] };
  assert.equal(validateCreateSpec(s), null);
});

const notFound = () => Promise.reject({ statusCode: 404 });
const mkRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "nw-rootfs-"));
  mkdirSync(join(root, "mnt/media/a/plain"), { recursive: true });
  // junction works without privileges on Windows and is a symlink to lstat; ignored on POSIX
  symlinkSync(root, join(root, "mnt/media/a/link"), "junction");
  return root;
};

test("host check refuses symlinked components, allows plain and missing paths", async () => {
  const rootfs = mkRoot();
  const run = (host: string, r: string | null = rootfs) =>
    checkCreateSpecHost(spec(host), { rootfs: r ?? undefined, inspectVolume: notFound });
  assert.equal(typeof (await run("/mnt/media/a/link")), "string");
  assert.equal(typeof (await run("/mnt/media/a/link/sub")), "string");
  assert.equal(await run("/mnt/media/a/plain"), null);
  assert.equal(await run("/mnt/media/a/new/dir"), null);
  assert.equal(typeof (await run("/mnt/media/a/plain", null)), "string");
  assert.equal(typeof (await run("/mnt/media/a/plain", join(rootfs, "missing"))), "string");
});

test("host check: existing named volume refused, 404 allowed, other errors refused", async () => {
  const run = (inspectVolume: () => Promise<unknown>) =>
    checkCreateSpecHost(spec("app_data"), { inspectVolume });
  assert.equal(typeof (await run(() => Promise.resolve({}))), "string");
  assert.equal(await run(notFound), null);
  assert.equal(typeof (await run(() => Promise.reject({ statusCode: 500 }))), "string");
  assert.equal(typeof (await run(() => Promise.reject(new Error("down")))), "string");
});

const withVols = (volumes: { host: string; container: string; readonly?: boolean }[]) => ({ image: "nginx", ports: [], env: [], volumes });

test("colon in a host or container path is refused (no Binds string to split)", () => {
  assert.ok(validateCreateSpec(withVols([{ host: "/mnt/media/../../..:/../mnt/media/z", container: "/data" }])));
  assert.ok(validateCreateSpec(withVols([{ host: "/mnt/media/x", container: "/data:/etc" }])));
  assert.ok(validateCreateSpec(withVols([{ host: "/mnt/media/x", container: "/data:ro" }])));
});

test("container path must be absolute and already normalised", () => {
  for (const c of ["data", "/a/../b", "/a/./b", "/a//b", "/a/"]) {
    assert.ok(validateCreateSpec(withVols([{ host: "/mnt/media/x", container: c }])), c);
  }
  assert.equal(validateCreateSpec(withVols([{ host: "/mnt/media/x", container: "/data" }])), null);
});

test("binds become read-only Mounts with the checked source; the readonly flag is ignored", () => {
  for (const readonly of [undefined, false, true]) {
    const m = buildMounts([{ host: "/mnt/media//x/", container: "/data", readonly }]);
    assert.deepEqual(m, [{ Type: "bind", Source: "/mnt/media/x", Target: "/data", ReadOnly: true, BindOptions: { ReadOnlyForceRecursive: true } }]);
  }
});

test("named volumes become volume Mounts and keep their readonly flag", () => {
  assert.deepEqual(buildMounts([{ host: "vol1", container: "/d", readonly: false }, { host: "", container: "/skip" }]), [
    { Type: "volume", Source: "vol1", Target: "/d", ReadOnly: false },
  ]);
});

test("CREATE_NETWORKS never lets host, none, container: or *_internal through", () => {
  process.env.CREATE_NETWORKS = "bridge,host,none,container:abc,x_internal";
  try {
    assert.equal(validateCreateSpec(spec("/mnt/media/x", "bridge")), null);
    for (const n of ["host", "none", "container:abc", "x_internal"]) {
      assert.ok(validateCreateSpec(spec("/mnt/media/x", n)), n);
    }
  } finally {
    delete process.env.CREATE_NETWORKS;
  }
});
