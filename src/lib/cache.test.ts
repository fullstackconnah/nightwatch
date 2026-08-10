import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KeyedMemo, Memo } from "./cache.ts";

/**
 * Memo state is process-wide and keyed by string (see cache.ts's module
 * comment), so every test must mint its own key or it would read another
 * test's cache. `k()` makes that mechanical.
 */
let counter = 0;
const k = (name: string) => `test.${name}.${counter++}`;

/** Controllable clock — none of these tests wait on real time. */
function fakeClock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A load function that records its call count and resolves on demand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Memo", () => {
  it("serves a cached value inside the TTL and reloads after it", async () => {
    const clock = fakeClock();
    let calls = 0;
    const memo = new Memo({
      key: k("ttl"),
      ttlMs: 1_000,
      now: clock.now,
      load: async () => ++calls,
    });

    assert.equal(await memo.get(), 1);
    clock.advance(999);
    assert.equal(await memo.get(), 1, "still inside TTL");
    assert.equal(calls, 1);

    clock.advance(1);
    assert.equal(await memo.get(), 2, "TTL elapsed — reloaded");
    assert.equal(calls, 2);
  });

  it("deduplicates concurrent callers onto one in-flight load", async () => {
    let calls = 0;
    const gate = deferred<string>();
    const memo = new Memo({
      key: k("dedup"),
      ttlMs: 1_000,
      load: () => {
        calls++;
        return gate.promise;
      },
    });

    // Three callers arrive before the first load settles — the exact shape of
    // a desk browser and a wall tablet polling the same collector.
    const all = Promise.all([memo.get(), memo.get(), memo.get()]);
    gate.resolve("vitals");

    assert.deepEqual(await all, ["vitals", "vitals", "vitals"]);
    assert.equal(calls, 1, "one collection, not three");
  });

  it("shares state across handles built from the same key (HMR survival)", async () => {
    const key = k("hmr");
    let calls = 0;
    const load = async () => ++calls;

    const before = new Memo({ key, ttlMs: 10_000, load });
    assert.equal(await before.get(), 1);

    // Module re-evaluated by a hot reload: a brand-new instance, same key.
    const after = new Memo({ key, ttlMs: 10_000, load });
    assert.equal(await after.get(), 1, "reads the previous instance's cache");
    assert.equal(calls, 1);
  });

  it("reloads when isValid rejects a still-fresh value", async () => {
    const clock = fakeClock();
    let calls = 0;
    const wanted = new Set(["a"]);
    const memo = new Memo<string[]>({
      key: k("valid"),
      ttlMs: 10_000,
      now: clock.now,
      // Mirrors docker.ts's membership check: fresh but missing a container
      // created since the last pass is not good enough.
      isValid: (cached) => [...wanted].every((id) => cached.includes(id)),
      load: async () => {
        calls++;
        return [...wanted];
      },
    });

    assert.deepEqual(await memo.get(), ["a"]);
    assert.equal(calls, 1);

    wanted.add("b");
    assert.deepEqual(await memo.get(), ["a", "b"], "membership changed — reloaded");
    assert.equal(calls, 2, "reloaded despite TTL not having expired");
  });

  it("force skips the cache read but still joins an in-flight load", async () => {
    let calls = 0;
    const memo = new Memo({
      key: k("force"),
      ttlMs: 60_000,
      load: async () => ++calls,
    });

    assert.equal(await memo.get(), 1);
    assert.equal(await memo.get({ force: true }), 2, "bypassed a fresh cache");
    assert.equal(calls, 2);

    // Two force callers racing must not fan out twice.
    const gate = deferred<number>();
    const racing = new Memo({
      key: k("force-race"),
      ttlMs: 60_000,
      load: () => {
        calls++;
        return gate.promise;
      },
    });
    const both = Promise.all([racing.get({ force: true }), racing.get({ force: true })]);
    gate.resolve(99);
    assert.deepEqual(await both, [99, 99]);
    assert.equal(calls, 3, "one extra call total, not two");
  });

  it("invalidate() drops the cached value", async () => {
    let calls = 0;
    const memo = new Memo({
      key: k("invalidate"),
      ttlMs: 60_000,
      load: async () => ++calls,
    });

    assert.equal(await memo.get(), 1);
    memo.invalidate();
    assert.equal(await memo.get(), 2);
    assert.equal(memo.peek(), 2);
  });

  it("rethrows by default and does not wedge later callers", async () => {
    let calls = 0;
    const memo = new Memo({
      key: k("throw"),
      ttlMs: 60_000,
      load: async () => {
        calls++;
        if (calls === 1) throw new Error("upstream down");
        return calls;
      },
    });

    await assert.rejects(() => memo.get(), /upstream down/);
    // The bug this guards: a rejected load leaving `inflight` set would make
    // every future caller await a promise that already rejected.
    assert.equal(await memo.get(), 2, "recovered on the next call");
  });

  it("serveStaleOnError returns the last good value when a reload fails", async () => {
    const clock = fakeClock();
    let calls = 0;
    const memo = new Memo({
      key: k("stale"),
      ttlMs: 1_000,
      now: clock.now,
      serveStaleOnError: true,
      load: async () => {
        calls++;
        if (calls === 1) return "names";
        throw new Error("docker unreachable");
      },
    });

    assert.equal(await memo.get(), "names");
    clock.advance(2_000);
    assert.equal(await memo.get(), "names", "served the stale value, did not throw");
    assert.equal(calls, 2);
  });

  it("serveStaleOnError still rejects when nothing was ever cached", async () => {
    const memo = new Memo({
      key: k("stale-empty"),
      ttlMs: 1_000,
      serveStaleOnError: true,
      load: async () => {
        throw new Error("cold failure");
      },
    });
    await assert.rejects(() => memo.get(), /cold failure/);
  });

  it("peek() returns the cached value regardless of age, null when empty", async () => {
    const clock = fakeClock();
    const memo = new Memo({
      key: k("peek"),
      ttlMs: 100,
      now: clock.now,
      load: async () => "scan",
    });

    assert.equal(memo.peek(), null);
    await memo.get();
    clock.advance(10_000);
    assert.equal(memo.peek(), "scan", "peek ignores the TTL");
  });
});

describe("KeyedMemo", () => {
  it("caches per key without one key blocking another", async () => {
    const calls: string[] = [];
    const memo = new KeyedMemo<string>({
      key: k("keyed"),
      ttlMs: 60_000,
      load: async (entryKey) => {
        calls.push(entryKey);
        return `scan:${entryKey}`;
      },
    });

    assert.equal(await memo.get("/mnt/media"), "scan:/mnt/media");
    assert.equal(await memo.get("/mnt/backup"), "scan:/mnt/backup");
    assert.equal(await memo.get("/mnt/media"), "scan:/mnt/media", "cached");
    assert.deepEqual(calls, ["/mnt/media", "/mnt/backup"]);
  });

  it("deduplicates concurrent callers per key", async () => {
    let calls = 0;
    const gate = deferred<string>();
    const memo = new KeyedMemo<string>({
      key: k("keyed-dedup"),
      ttlMs: 60_000,
      load: () => {
        calls++;
        return gate.promise;
      },
    });

    const both = Promise.all([memo.get("disk"), memo.get("disk")]);
    gate.resolve("one scan");
    assert.deepEqual(await both, ["one scan", "one scan"]);
    assert.equal(calls, 1);
  });

  it("invalidate(key) clears one entry; invalidate() clears all", async () => {
    let calls = 0;
    const memo = new KeyedMemo<number>({
      key: k("keyed-invalidate"),
      ttlMs: 60_000,
      load: async () => ++calls,
    });

    await memo.get("a");
    await memo.get("b");
    assert.equal(calls, 2);

    memo.invalidate("a");
    await memo.get("a");
    await memo.get("b");
    assert.equal(calls, 3, "only 'a' reloaded");

    memo.invalidate();
    await memo.get("a");
    await memo.get("b");
    assert.equal(calls, 5, "both reloaded");
  });
});
