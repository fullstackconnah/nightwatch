import { test } from "node:test";
import assert from "node:assert/strict";
import { createSwr, withTimeout } from "./single-flight.ts";

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

test("two concurrent callers trigger one fetch", async () => {
  let calls = 0;
  const d = deferred<number>();
  const swr = createSwr(() => (calls++, d.promise), 1000, () => 0);
  const a = swr.get();
  const b = swr.get();
  d.resolve(7);
  assert.deepEqual(await Promise.all([a, b]), [7, 7]);
  assert.equal(calls, 1);
});

test("stale data returns at once while one refresh runs", async () => {
  let t = 0;
  let calls = 0;
  const ds = [deferred<string>(), deferred<string>()];
  const swr = createSwr(() => ds[calls++].promise, 1000, () => t);
  ds[0].resolve("old");
  assert.equal(await swr.get(), "old");
  t = 5000;
  assert.equal(await swr.get(), "old"); // immediate, refresh started
  assert.equal(await swr.get(), "old");
  assert.equal(calls, 2);
  ds[1].resolve("new");
  await new Promise((r) => setImmediate(r));
  assert.equal(swr.peek(), "new");
  assert.equal(await swr.get(), "new");
});

test("slow promise yields the fallback at the timeout, later result still lands in the cache", async () => {
  const d = deferred<string>();
  const swr = createSwr(() => d.promise, 1000, () => 0);
  const r = await withTimeout(swr.get(), 10, () => swr.peek() ?? null);
  assert.equal(r, null);
  d.resolve("late");
  await new Promise((r) => setImmediate(r));
  assert.equal(swr.peek(), "late");
});

test("fast promise wins and clears the timer", async () => {
  const r = await withTimeout(Promise.resolve(1), 60_000, () => 0);
  assert.equal(r, 1); // test would hang on exit if the timer leaked
});

test("a rejected refresh keeps the old data and does not leak a rejection", async () => {
  let t = 0;
  let n = 0;
  const swr = createSwr(() => (n++ === 0 ? Promise.resolve("ok") : Promise.reject(new Error("x"))), 1000, () => t);
  assert.equal(await swr.get(), "ok");
  t = 5000;
  assert.equal(await swr.get(), "ok");
  await new Promise((r) => setImmediate(r));
  assert.equal(swr.peek(), "ok");
  assert.equal(await swr.get(), "ok"); // retries after failure
  assert.equal(n, 3);
});
