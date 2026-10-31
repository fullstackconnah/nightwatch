import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { allowAsk, reset } from "./kiosk-ask-limit.ts";

const T0 = 1_000_000;
const DAY = 24 * 60 * 60_000;

describe("kiosk ask limit", () => {
  beforeEach(() => reset());

  it("refuses a second ask at +4.9 s with the short reason", () => {
    assert.deepEqual(allowAsk(T0), { ok: true });
    assert.deepEqual(allowAsk(T0 + 4_900), { ok: false, reason: "rate" });
  });

  it("allows a second ask at +5 s", () => {
    allowAsk(T0);
    assert.deepEqual(allowAsk(T0 + 5_000), { ok: true });
  });

  it("a refused ask does not push the next slot back", () => {
    allowAsk(T0);
    allowAsk(T0 + 4_900);
    assert.deepEqual(allowAsk(T0 + 5_000), { ok: true });
  });

  it("refuses the 201st ask in 24 h even when spaced out, with the daily reason", () => {
    for (let i = 0; i < 200; i++) assert.equal(allowAsk(T0 + i * 6_000).ok, true);
    assert.deepEqual(allowAsk(T0 + 200 * 6_000), { ok: false, reason: "daily" });
  });

  it("the oldest ask dropping out of the window frees a slot", () => {
    for (let i = 0; i < 200; i++) allowAsk(T0 + i * 6_000);
    assert.equal(allowAsk(T0 + DAY - 1).ok, false);
    assert.equal(allowAsk(T0 + DAY).ok, true);
  });
});
