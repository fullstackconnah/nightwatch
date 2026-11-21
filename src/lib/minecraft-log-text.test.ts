import test from "node:test";
import assert from "node:assert/strict";
import { logStripText } from "./minecraft-log-text.ts";

test("logStripText: loaded logs show as they are", () => {
  assert.equal(logStripText("line", false, "loading"), null);
  assert.equal(logStripText("line", true, "docker-failed"), null); // stale logs stay, the page says "Couldn't refresh."
});
test("logStripText: each reason a log is missing has its own sentence", () => {
  assert.deepEqual(logStripText(undefined, true, "loading"), { text: "Couldn't read logs.", bad: true });
  assert.deepEqual(logStripText("", false, "loading"), { text: "no output", bad: false });
  assert.deepEqual(logStripText(undefined, false, "docker-failed"), { text: "Couldn't reach Docker.", bad: true });
  assert.deepEqual(logStripText(undefined, false, "no-container"), { text: "No Minecraft container.", bad: false });
  assert.deepEqual(logStripText(undefined, false, "paused"), { text: "Paused before any logs loaded.", bad: false });
  assert.deepEqual(logStripText(undefined, false, "loading"), { text: "Reading logs…", bad: false });
});
