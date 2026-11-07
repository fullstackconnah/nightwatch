import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttemptLimiter } from "./attempt-limiter.ts";

describe("attempt limiter", () => {
  it("attempt() counts synchronously: the 6th back-to-back call is refused", () => {
    const l = createAttemptLimiter({ now: () => 0 });
    const results = Array.from({ length: 6 }, () => l.attempt());
    assert.deepEqual(results, [true, true, true, true, true, false]);
  });
  it("attempt(): reset() clears the count, and the lock ends after the window", () => {
    let t = 0;
    const l = createAttemptLimiter({ now: () => t });
    for (let i = 0; i < 4; i++) l.attempt();
    l.reset();
    for (let i = 0; i < 4; i++) assert.equal(l.attempt(), true);
    assert.equal(l.attempt(), true); // 5th locks
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
