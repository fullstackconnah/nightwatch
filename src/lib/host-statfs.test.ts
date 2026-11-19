import test, { after } from "node:test";
import assert from "node:assert/strict";
import { statfsWithDeadline, pendingStatfsTargets } from "./host-statfs.ts";

const stat = { bsize: 1, blocks: 10, bfree: 5, bavail: 5 } as never;
const never = () => new Promise<never>(() => {});
// The deadline timer is unref'd, so a hung statfs leaves nothing else alive: keep the loop up while tests wait on it.
const keepAlive = setInterval(() => {}, 1_000);
after(() => clearInterval(keepAlive));

test("healthy statfs returns the value and leaves nothing pending", async () => {
  assert.equal(await statfsWithDeadline("/a", { statfs: async () => stat, deadlineMs: 20 }), stat);
  assert.equal(pendingStatfsTargets.size, 0);
});

test("rejecting statfs returns null and leaves nothing pending", async () => {
  const r = await statfsWithDeadline("/b", { statfs: async () => { throw new Error("EIO"); }, deadlineMs: 20 });
  assert.equal(r, null);
  assert.equal(pendingStatfsTargets.size, 0);
});

test("hung statfs: null after deadline, no second call while pending, other target works", async () => {
  let calls = 0;
  const hung = () => { calls++; return never(); };
  assert.equal(await statfsWithDeadline("/h", { statfs: hung, deadlineMs: 20 }), null);
  assert.equal(await statfsWithDeadline("/h", { statfs: hung, deadlineMs: 20 }), null);
  assert.equal(calls, 1);
  assert.equal(await statfsWithDeadline("/ok", { statfs: async () => stat, deadlineMs: 20 }), stat);
});

test("hung call settling late frees the target for the next call", async () => {
  let release!: (v: unknown) => void;
  const late = () => new Promise((res) => { release = res; });
  assert.equal(await statfsWithDeadline("/l", { statfs: late as never, deadlineMs: 20 }), null);
  assert.ok(pendingStatfsTargets.has("/l"));
  release(stat);
  await new Promise((r) => setImmediate(r));
  assert.ok(!pendingStatfsTargets.has("/l"));
  assert.equal(await statfsWithDeadline("/l", { statfs: async () => stat, deadlineMs: 20 }), stat);
});

test("hung first mount does not hide the healthy second", async () => {
  const [a, b] = await Promise.all([
    statfsWithDeadline("/x1", { statfs: never as never, deadlineMs: 20 }),
    statfsWithDeadline("/x2", { statfs: async () => stat, deadlineMs: 20 }),
  ]);
  assert.equal(a, null);
  assert.equal(b, stat);
});

test("a synchronous throw returns null and leaves the target out of the set", async () => {
  const boom = (() => { throw new Error("sync"); }) as never;
  assert.equal(await statfsWithDeadline("/s", { statfs: boom, deadlineMs: 20 }), null);
  assert.ok(!pendingStatfsTargets.has("/s"));
});

test("deadline wins, then the promise rejects: target freed, no unhandled rejection", async () => {
  let fail!: (e: Error) => void;
  const late = () => new Promise((_, rej) => { fail = rej; });
  assert.equal(await statfsWithDeadline("/r", { statfs: late as never, deadlineMs: 20 }), null);
  assert.ok(pendingStatfsTargets.has("/r"));
  fail(new Error("EIO"));
  await new Promise((r) => setImmediate(r));
  assert.ok(!pendingStatfsTargets.has("/r"));
});
