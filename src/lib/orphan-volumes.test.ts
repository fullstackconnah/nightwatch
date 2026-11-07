import assert from "node:assert/strict";
import { test } from "node:test";
import { ANONYMOUS_LABEL, isOrphanVolume, orphanVolumeNames, removeVolumes, usedVolumeNames } from "./orphan-volumes.ts";

const anon = { Name: "a1", Labels: { [ANONYMOUS_LABEL]: "" } };
const named = { Name: "pgdata", Labels: {} };

test("anonymous and unreferenced is an orphan", () => {
  assert.equal(isOrphanVolume(anon, new Set()), true);
});

test("named and unreferenced is not an orphan", () => {
  assert.equal(isOrphanVolume(named, new Set()), false);
  assert.equal(isOrphanVolume({ Name: "x", Labels: null }, new Set()), false);
});

test("anonymous but referenced by a stopped container is not an orphan", () => {
  assert.equal(isOrphanVolume(anon, new Set(["a1"])), false);
});

test("removes only the listed names, skips an in-use refusal, keeps going", async () => {
  const seen: string[] = [];
  const res = await removeVolumes(["a", "b", "c"], async (n) => {
    seen.push(n);
    if (n === "b") throw Object.assign(new Error("in use"), { statusCode: 409 });
  });
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.deepEqual(res, { removed: ["a", "c"], skipped: ["b"], failed: [] });
});

test("other failures are listed, not thrown", async () => {
  const res = await removeVolumes(["a"], async () => { throw Object.assign(new Error("x"), { statusCode: 403 }); });
  assert.deepEqual(res, { removed: [], skipped: [], failed: ["a"] });
});

test("orphanVolumeNames: only the anonymous unused name; null volumes gives []", () => {
  const volumes: { Name: string; Labels: Record<string, string> }[] = [
    { Name: "pgdata", Labels: {} },
    { Name: "stopped-mount", Labels: { [ANONYMOUS_LABEL]: "" } },
    { Name: "a2", Labels: { [ANONYMOUS_LABEL]: "" } },
  ];
  const containers = [{ Mounts: [{ Type: "volume", Name: "stopped-mount" }] }];
  assert.deepEqual(orphanVolumeNames(volumes, containers), ["a2"]);
  assert.deepEqual(orphanVolumeNames(null, containers), []);
  assert.deepEqual(orphanVolumeNames(undefined, containers), []);
});

test("usedVolumeNames: volume mounts by Name, stopped counted, binds ignored", () => {
  const names = usedVolumeNames([
    { Mounts: [{ Type: "volume", Name: "v1" }, { Type: "bind", Name: "b1" }] },
    { Mounts: [{ Type: "volume", Name: "v2" }] },
    {},
  ]);
  assert.deepEqual([...names].sort(), ["v1", "v2"]);
});
