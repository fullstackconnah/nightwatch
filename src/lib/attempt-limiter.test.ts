import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttemptLimiter } from "./attempt-limiter.ts";

describe("attempt limiter", () => {
  it("locks after 5 failures and unlocks after the window", () => {
    let t = 1000;
    const l = createAttemptLimiter({ now: () => t });
    for (let i = 0; i < 4; i++) l.fail();
    assert.equal(l.isLocked(), false);
    l.fail();
    assert.equal(l.isLocked(), true);
    t += 59_999;
    assert.equal(l.isLocked(), true);
    t += 1;
    assert.equal(l.isLocked(), false);
  });
  it("a success resets the count, and a lock restarts the count", () => {
    const l = createAttemptLimiter({ now: () => 0 });
    for (let i = 0; i < 4; i++) l.fail();
    l.reset();
    for (let i = 0; i < 4; i++) l.fail();
    assert.equal(l.isLocked(), false);
  });
  it("instances are independent", () => {
    const a = createAttemptLimiter({ now: () => 0 });
    const b = createAttemptLimiter({ now: () => 0 });
    for (let i = 0; i < 5; i++) a.fail();
    assert.equal(a.isLocked(), true);
    assert.equal(b.isLocked(), false);
  });
});
