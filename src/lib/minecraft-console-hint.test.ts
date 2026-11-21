import assert from "node:assert/strict";
import { test } from "node:test";
import { consoleHint } from "./minecraft-console-hint.ts";

test("consoleHint: unconfigured wins over everything", () => {
  assert.equal(consoleHint("unconfigured", false, true), "RCON not configured — add it in Settings → Integrations");
});
test("consoleHint: a stopped server says so, not booting", () => {
  assert.equal(consoleHint("unavailable", false, false), "server is stopped — start it to use the console");
});
test("consoleHint: running with RCON not answering is booting", () => {
  assert.equal(consoleHint("unavailable", true, false), "booting — console unavailable");
});
test("consoleHint: a stale page says it is paused", () => {
  assert.equal(consoleHint("ok", true, true), "paused while the page shows old data");
});
test("consoleHint: stopped and stale together give the stopped sentence", () => {
  assert.equal(consoleHint("ok", false, true), "server is stopped — start it to use the console");
});
test("consoleHint: running, answering, fresh has no hint", () => {
  assert.equal(consoleHint("ok", true, false), null);
});
test("consoleHint: a paused server says paused, not booting", () => {
  assert.equal(consoleHint("unavailable", true, false, true), "server is paused — resume it to use the console");
});
test("consoleHint: a paused server is refused even when RCON answers", () => {
  assert.equal(consoleHint("ok", true, false, true), "server is paused — resume it to use the console");
});
test("consoleHint: paused loses to unconfigured and to stopped", () => {
  assert.equal(consoleHint("unconfigured", true, false, true), "RCON not configured — add it in Settings → Integrations");
  assert.equal(consoleHint("ok", false, false, true), "server is stopped — start it to use the console");
});
