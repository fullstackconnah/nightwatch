import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mapJobBody } from "./hermes-job-map.ts";
import { shouldKeepPolling } from "./hermes-poll.ts";

test("F12: an unknown non-empty state is still running", () => {
  assert.equal(mapJobBody({ state: "queued", kind: "ask" }).state, "running");
});

test("F12: a missing or non-string state is an error with a message", () => {
  for (const raw of [{}, null, { state: 3 }, { state: "" }]) {
    const j = mapJobBody(raw);
    assert.equal(j.state, "error");
    assert.equal(j.error, "Hermes sent no job state.");
  }
});

test("F12: known states and the summarize kind are kept", () => {
  assert.equal(mapJobBody({ state: "done", kind: "summarize" }).kind, "summarize");
  assert.equal(mapJobBody({ state: "error", error: "boom" }).error, "boom");
});

test("F11: unreachable retries inside the deadline, 404 and the deadline stop", () => {
  assert.equal(shouldKeepPolling("unreachable", 1000, 2000), true);
  assert.equal(shouldKeepPolling("unreachable", 2000, 2000), false);
  assert.equal(shouldKeepPolling("not-found", 1000, 2000), false);
  assert.equal(shouldKeepPolling("unauthorized", 1000, 2000), false);
});

test("F11: askHermes uses the retry decision", () => {
  const route = readFileSync(fileURLToPath(new URL("../app/kiosk/api/assistant/route.ts", import.meta.url)), "utf8");
  assert.match(route, /shouldKeepPolling\(/);
});
