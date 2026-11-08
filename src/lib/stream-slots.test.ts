import test from "node:test";
import assert from "node:assert/strict";
import { createStreamSlots, releaseOnEnd } from "./stream-slots.ts";

const bytes = (n: number) => new Uint8Array([n]);
const upstream = (chunks: number[], err?: Error) => {
  let i = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(bytes(chunks[i++]!));
      else if (err) c.error(err);
      else c.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, wasCancelled: () => cancelled };
};

test("slot returns to 0 when the stream is read to the end", async () => {
  const slots = createStreamSlots(3);
  const release = slots.acquire()!;
  assert.equal(slots.open(), 1);
  const out = releaseOnEnd(upstream([1, 2]).body, release);
  const reader = out.getReader();
  assert.equal((await reader.read()).done, false);
  assert.equal(slots.open(), 1);
  await reader.read();
  assert.equal((await reader.read()).done, true);
  assert.equal(slots.open(), 0);
});

test("slot returns to 0 when the consumer cancels, and upstream is cancelled", async () => {
  const slots = createStreamSlots(3);
  const release = slots.acquire()!;
  const up = upstream([1, 2, 3]);
  const out = releaseOnEnd(up.body, release);
  const reader = out.getReader();
  await reader.read();
  await reader.cancel("gone");
  assert.equal(slots.open(), 0);
  assert.equal(up.wasCancelled(), true);
});

test("slot returns to 0 when the upstream errors", async () => {
  const slots = createStreamSlots(3);
  const release = slots.acquire()!;
  const out = releaseOnEnd(upstream([1], new Error("boom")).body, release);
  const reader = out.getReader();
  await reader.read();
  await assert.rejects(reader.read(), /boom/);
  assert.equal(slots.open(), 0);
});

test("release runs once when abort and cancel both fire", async () => {
  const slots = createStreamSlots(3);
  const other = slots.acquire()!;
  const release = slots.acquire()!;
  const ac = new AbortController();
  ac.signal.addEventListener("abort", release, { once: true });
  const out = releaseOnEnd(upstream([1, 2]).body, release);
  const reader = out.getReader();
  await reader.read();
  ac.abort();
  await reader.cancel();
  assert.equal(slots.open(), 1); // only the other stream's slot remains
  other();
  assert.equal(slots.open(), 0);
});
