import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goLive } from "./sse-live.ts";

describe("goLive", () => {
  it("undoes the subscriptions and starts no heartbeat when teardown ran during subscribe", () => {
    let closed = false;
    let undone = 0;
    const live = goLive(
      () => closed,
      () => {
        closed = true; // a first enqueue failed inside subscribe and tore the stream down
        return [() => undone++, () => undone++];
      },
      () => assert.fail("heartbeat must not run"),
      5,
    );
    assert.equal(live, null);
    assert.equal(undone, 2);
  });

  it("starts the heartbeat and keeps the subscriptions when still open", () => {
    let undone = 0;
    const live = goLive(
      () => false,
      () => [() => undone++],
      () => {},
      60_000,
    );
    assert.ok(live);
    assert.equal(undone, 0);
    clearInterval(live.timer);
    live.unsubscribe();
    assert.equal(undone, 1);
  });
});
