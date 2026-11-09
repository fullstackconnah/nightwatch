import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PULL_STALLED_MESSAGE, guardPullIdle } from "./pull-idle.ts";

function fakeStream() {
  const s = new EventEmitter() as EventEmitter & { destroy(): void; destroyed?: boolean };
  s.destroy = () => {
    s.destroyed = true;
  };
  return s;
}

test("H21U F1: a pull with no progress for idleMs is destroyed and rejected", async () => {
  const s = fakeStream();
  const errs: Error[] = [];
  guardPullIdle(s, 20, (e) => errs.push(e));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.destroyed, true);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].message, PULL_STALLED_MESSAGE);
});

test("H21U F1: progress events keep the pull alive, stop() clears the timer", async () => {
  const s = fakeStream();
  const errs: Error[] = [];
  const stop = guardPullIdle(s, 40, (e) => errs.push(e));
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 20));
    s.emit("data", Buffer.from("{}"));
  }
  assert.equal(errs.length, 0);
  stop();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(errs.length, 0);
  assert.notEqual(s.destroyed, true);
});
