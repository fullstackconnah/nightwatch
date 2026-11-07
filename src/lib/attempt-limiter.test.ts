import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttemptLimiter } from "./attempt-limiter.ts";

describe("attempt limiter", () => {
  it("attempt() counts synchronously: 5 back-to-back calls pass, the 6th is refused", () => {
    const l = createAttemptLimiter({ now: () => 0 });
    const results = Array.from({ length: 6 }, () => l.attempt());
    assert.deepEqual(results, [true, true, true, true, true, false]);
  });
  it("reset() clears the count: 4 tries, reset, then 5 more pass", () => {
    const l = createAttemptLimiter({ now: () => 0 });
    for (let i = 0; i < 4; i++) l.attempt();
    l.reset();
    for (let i = 0; i < 5; i++) assert.equal(l.attempt(), true);
    assert.equal(l.attempt(), false);
  });
  it("a correct 5th try never leaves a lock: 4 tries, the 5th, reset(), the next passes", () => {
    const l = createAttemptLimiter({ now: () => 0 });
    for (let i = 0; i < 4; i++) l.attempt();
    assert.equal(l.attempt(), true);
    l.reset();
    assert.equal(l.attempt(), true);
  });
  it("5 wrong tries, then a try after the lock window passes", () => {
    let t = 0;
    const l = createAttemptLimiter({ now: () => t });
    for (let i = 0; i < 5; i++) l.attempt();
    t += 60_001;
    assert.equal(l.attempt(), true);
  });
  it("the lock ends after the window", () => {
    let t = 0;
    const l = createAttemptLimiter({ now: () => t });
    for (let i = 0; i < 5; i++) l.attempt();
    assert.equal(l.attempt(), false);
    t += 59_999;
    assert.equal(l.attempt(), false);
    t += 1;
    assert.equal(l.attempt(), true);
  });
  it("instances are independent", () => {
    const a = createAttemptLimiter({ now: () => 0 });
    const b = createAttemptLimiter({ now: () => 0 });
    for (let i = 0; i < 6; i++) a.attempt();
    assert.equal(a.attempt(), false);
    assert.equal(b.attempt(), true);
  });
});
