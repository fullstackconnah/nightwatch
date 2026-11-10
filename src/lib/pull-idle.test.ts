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

test("H21U F1: a pull with no progress for idleMs is destroyed and rejected", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = fakeStream();
  const errs: Error[] = [];
  guardPullIdle(s, 20, (e) => errs.push(e));
  t.mock.timers.tick(19);
  assert.equal(s.destroyed, undefined);
  t.mock.timers.tick(1);
  assert.equal(s.destroyed, true);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].message, PULL_STALLED_MESSAGE);
});

test("H21U F1: progress events keep the pull alive, stop() clears the timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = fakeStream();
  const errs: Error[] = [];
  const stop = guardPullIdle(s, 40, (e) => errs.push(e));
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(20);
    s.emit("data", Buffer.from("{}"));
  }
  assert.equal(errs.length, 0);
  stop();
  t.mock.timers.tick(80);
  assert.equal(errs.length, 0);
  assert.notEqual(s.destroyed, true);
});
