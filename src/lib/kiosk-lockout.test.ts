import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createKioskLockout } from "./kiosk-lockout.ts";

function setup(start = 1_000_000) {
  let t = start;
  const lock = createKioskLockout(() => t);
  return { lock, advance: (ms: number) => (t += ms), now: () => t };
}

/** Fail until the lockout trips; returns the lockedUntil it set. */
function trip(s: ReturnType<typeof setup>): number {
  let until = 0;
  for (let i = 0; i < 5; i++) until = s.lock.fail();
  return until;
}

describe("kiosk PIN lockout", () => {
  it("locks after 5 failures for 30 s, not before", () => {
    const s = setup();
    for (let i = 0; i < 4; i++) assert.equal(s.lock.fail(), 0);
    assert.equal(s.lock.lockedUntil(), 0);
    assert.equal(s.lock.fail(), s.now() + 30_000);
    assert.equal(s.lock.lockedUntil(), s.now() + 30_000);
  });

  it("is one global record: failures never depend on a caller identity", () => {
    const route = readFileSync(new URL("../app/api/auth/kiosk/route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(route, /x-forwarded-for|x-real-ip/i);
  });

  it("doubles each further lockout, capped at 15 min", () => {
    const s = setup();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      const until = trip(s);
      waits.push(until - s.now());
      s.advance(until - s.now());
    }
    assert.deepEqual(waits, [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
  });

  it("lockedUntil is 0 once the lock has expired", () => {
    const s = setup();
    const until = trip(s);
    s.advance(until - s.now());
    assert.equal(s.lock.lockedUntil(), 0);
  });

  it("a correct PIN resets failures and the escalation", () => {
    const s = setup();
    const until = trip(s);
    s.advance(until - s.now());
    trip(s); // second lockout, 60 s
    s.lock.reset();
    assert.equal(s.lock.lockedUntil(), 0);
    assert.equal(trip(s) - s.now(), 30_000);
  });
});
