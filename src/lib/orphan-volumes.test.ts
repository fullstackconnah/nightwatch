import assert from "node:assert/strict";
import { test } from "node:test";
import { ANONYMOUS_LABEL, isOrphanVolume, removeVolumes } from "./orphan-volumes.ts";

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
  assert.deepEqual(res, { removed: ["a", "c"], skipped: ["b"] });
});

test("other failures still surface", async () => {
  await assert.rejects(
    removeVolumes(["a"], async () => { throw Object.assign(new Error("x"), { statusCode: 403 }); }),
  );
});
