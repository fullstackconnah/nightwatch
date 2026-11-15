import { test } from "node:test";
import assert from "node:assert/strict";
import { applyQueue, enqueue, outcome, parseQueue, queuedIds, removeIds, repoint, settle, QUEUE_CAP, type QueueOp } from "./kiosk-list-queue.ts";
import type { ListItem } from "./kiosk-list.ts";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const add = (n: number, text = "Tea"): QueueOp => ({ op: "add", body: { listId: "shopping", id: ID(n), text } });
const done = (n: number, d: boolean): QueueOp => ({ op: "done", body: { listId: "shopping", id: ID(n), done: d } });
const item = (n: number, o: Partial<ListItem> = {}): ListItem => ({ id: ID(n), listId: "shopping", text: "I" + n, done: false, createdAt: n, doneAt: null, updatedAt: n, ...o });

test("22a a newer done for an id replaces the older one", () => {
  const q = enqueue(enqueue([], done(1, true)), done(1, false));
  assert.deepEqual(q, [done(1, false)]);
});

test("22b cap 32 drops the oldest done, never an add", () => {
  let q: QueueOp[] = [];
  for (let i = 1; i <= 13; i++) q = enqueue(q, add(i));
  for (let i = 1; i <= 13; i++) q = enqueue(q, done(i, true));
  for (let i = 14; i <= 19; i++) q = enqueue(q, add(i, "x" + i)); // 13 + 13 + 6 = 32
  assert.equal(q.length, QUEUE_CAP);
  q = enqueue(q, add(20, "y"));
  assert.equal(q.length, QUEUE_CAP);
  assert.equal(q.filter((o) => o.op === "add").length, 20);
  assert.ok(!q.some((o) => o.op === "done" && o.body.id === ID(1)), "oldest done dropped");
  assert.ok(q.some((o) => o.op === "done" && o.body.id === ID(2)));
});

test("22c a corrupt or malformed blob parses to an empty or filtered queue", () => {
  assert.deepEqual(parseQueue(null), []);
  assert.deepEqual(parseQueue("{nope"), []);
  assert.deepEqual(parseQueue('{"a":1}'), []);
  const good = add(1);
  assert.deepEqual(parseQueue(JSON.stringify([good, { op: "add", body: { id: "1" } }, 5, null, { op: "zap", body: {} }])), [good]);
});

test("22d outcome per status", () => {
  for (const s of [200, 201]) assert.equal(outcome(s), "ok");
  for (const s of [400, 403, 404, 413]) assert.equal(outcome(s), "drop");
  assert.equal(outcome(409), "full");
  for (const s of [429, 500, 503, null]) assert.equal(outcome(s), "keep");
});

test("22e repoint moves a queued done to the server item's id", () => {
  assert.deepEqual(repoint([done(1, true), done(2, true)], ID(1), ID(9)), [done(9, true), done(2, true)]);
});

test("22f applyQueue shows a pending add on top and a pending tick as done; unknown done ids are skipped", () => {
  const out = applyQueue([item(1), item(2)], [add(5, "Tea"), add(6, "Jam"), done(1, true), done(77, true)], 1000);
  assert.deepEqual(out.map((i) => [i.text, i.done]), [["Jam", false], ["Tea", false], ["I2", false], ["I1", true]]);
  assert.equal(out.find((i) => i.id === ID(1))?.doneAt, 1000);
  assert.equal(applyQueue([item(5, { text: "Tea" })], [add(5, "Tea")], 1000).length, 1, "an add already on the server is not doubled");
});

test("22g applyQueue: an add of a ticked item's name revives it in place; of an open item's name changes nothing", () => {
  const items = [item(1, { text: "Oat milk", done: true, doneAt: 4 }), item(2, { text: "Bread" })];
  const out = applyQueue(items, [add(7, "  oat MILK "), add(8, "bread")], 1000);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((i) => [i.id, i.done]), [[ID(1), false], [ID(2), false]]);
  assert.equal(out[0].doneAt, null);
});

test("22h queuedIds: every waiting write marks its row, once per id, so each shows Not saved (fix item 2)", () => {
  assert.deepEqual(queuedIds([]), []);
  assert.deepEqual(queuedIds([add(1), add(2), done(1, true), done(3, false)]), [ID(1), ID(2), ID(3)]);
});

test("22i a full answer to a queued add drops it, leaves no mark and asks for the full hint", () => {
  const q = [add(1), add(2)];
  const r = settle(q, [ID(1)], q[0], outcome(409));
  assert.deepEqual(r.queue.map((o) => o.body.id), [ID(2)]);
  assert.ok(!r.failed.includes(ID(1)));
  assert.equal(r.full, true);
  assert.equal(r.stop, false);
});

test("22j a kept answer keeps the entry, marks every queued id and stops the drain", () => {
  for (const s of [null, 429, 503]) {
    const q = [add(1), add(2), done(3, true)];
    const r = settle(q, [], q[0], outcome(s));
    assert.deepEqual(r.queue, q);
    assert.deepEqual(r.failed, [ID(1), ID(2), ID(3)]);
    assert.equal(r.stop, true);
    assert.equal(r.full, false);
  }
});

test("22k after a partial drain the saved id has no mark and the rest are marked", () => {
  const q = [add(1), add(2), add(3)];
  const a = settle(q, [], q[0], "keep");
  const b = settle(a.queue, a.failed, q[0], "ok", ID(1));
  assert.equal(b.saved, true, "it was marked and is saved now");
  assert.deepEqual(b.failed, [ID(2), ID(3)]);
  const c = settle(b.queue, b.failed, q[1], "keep");
  assert.deepEqual(c.queue.map((o) => o.body.id), [ID(2), ID(3)]);
  assert.deepEqual(c.failed, [ID(2), ID(3)]);
  assert.equal(c.stop, true);
});

test("22l exists, replay, revived and added drop the entry with no mark and no hint", () => {
  for (const [out, served] of [["ok", ID(1)], ["ok", ID(9)], ["drop", undefined]] as const) {
    const q = [add(1), add(2)];
    const r = settle(q, [], q[0], out, served);
    assert.deepEqual(r.queue.map((o) => o.body.id), [ID(2)]);
    assert.deepEqual(r.failed, []);
    assert.equal(r.full, false);
    assert.equal(r.stop, false);
  }
  const t = [add(1), done(1, true)];
  assert.deepEqual(settle(t, [], t[0], "ok", ID(9)).queue, [done(9, true)], "ticks follow the server item");
});

test("22m after the last entry drains no marks remain", () => {
  const q = [add(1)];
  const r = settle(q, [ID(1)], q[0], "ok", ID(1));
  assert.deepEqual(r.queue, []);
  assert.deepEqual(r.failed, []);
  assert.equal(r.saved, true);
});

test("22n removeIds drops only the snapshotted ids; entries queued after the snapshot survive", () => {
  const snap = queuedIds([add(1), done(2, true)]);
  assert.deepEqual(removeIds([add(1), done(2, true), add(3)], snap), [add(3)]);
  assert.deepEqual(removeIds([add(3)], []), [add(3)]);
});
