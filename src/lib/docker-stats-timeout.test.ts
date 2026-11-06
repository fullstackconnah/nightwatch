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

test("an AbortSignal.timeout passed to a call aborts it, so the socket would close", async () => {
  const signal = AbortSignal.timeout(50);
  const call = (s: AbortSignal) =>
    new Promise<never>((_, rej) => s.addEventListener("abort", () => rej(new Error("aborted"))));
  await assert.rejects(call(signal), /aborted/);
});
