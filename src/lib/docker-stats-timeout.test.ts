import assert from "node:assert/strict";
import { test } from "node:test";
import { mapWithin } from "./single-flight.ts";

test("a call that never answers is dropped; the other results are kept", async () => {
  const t0 = Date.now();
  const out = await mapWithin(
    ["ok", "hung", "bad"],
    (id) => (id === "ok" ? Promise.resolve(7) : id === "bad" ? Promise.reject(new Error("x")) : new Promise<number>(() => {})),
    50,
  );
  assert.deepEqual(out, [["ok", 7]]);
  assert.ok(Date.now() - t0 < 1000);
});
