import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api-error.ts";
import { consoleHint, consoleSendError } from "./minecraft-console-hint.ts";

const UNREACHED = "Couldn't reach the dashboard. The command may not have run.";
test("consoleSendError: an ApiError keeps the server's sentence", () => {
  assert.equal(consoleSendError(new ApiError("The server didn't reply over RCON", 502)), "The server didn't reply over RCON");
});
test("consoleSendError: an ApiError with no message falls back to command failed", () => {
  assert.equal(consoleSendError(new ApiError("", 500)), "command failed");
});
test("consoleSendError: Chrome's 'Failed to fetch' becomes the fixed sentence", () => {
  assert.equal(consoleSendError(new TypeError("Failed to fetch")), UNREACHED);
});
test("consoleSendError: Safari's 'Load failed' becomes the fixed sentence", () => {
  assert.equal(consoleSendError(new TypeError("Load failed")), UNREACHED);
});
test("consoleSendError: any other Error becomes the fixed sentence", () => {
  assert.equal(consoleSendError(new Error("boom")), UNREACHED);
});
test("consoleSendError: a thrown string becomes the fixed sentence", () => {
  assert.equal(consoleSendError("boom"), UNREACHED);
});
test("consoleSendError: undefined becomes the fixed sentence", () => {
  assert.equal(consoleSendError(undefined), UNREACHED);
});

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
test("consoleHint: paused on a stale page gives the stale line, not 'resume it' while Resume is off", () => {
  assert.equal(consoleHint("ok", true, true, true), "paused while the page shows old data");
  assert.equal(consoleHint("ok", true, false, true), "server is paused — resume it to use the console");
});
test("consoleHint: paused loses to unconfigured and to stopped", () => {
  assert.equal(consoleHint("unconfigured", true, false, true), "RCON not configured — add it in Settings → Integrations");
  assert.equal(consoleHint("ok", false, false, true), "server is stopped — start it to use the console");
});

test("consoleHint: a rejected password names the fix", () => {
  assert.equal(consoleHint("rejected", true, false), "RCON password rejected. Check it in Settings.");
});
test("consoleHint: stopped and paused win over a rejected password, which wins over stale (as unavailable does)", () => {
  assert.equal(consoleHint("rejected", false, false), "server is stopped — start it to use the console");
  assert.equal(consoleHint("rejected", true, false, true), "server is paused — resume it to use the console");
  assert.equal(consoleHint("rejected", true, true), "RCON password rejected. Check it in Settings.");
});
test("status route sets rejected only for an Error 'rcon auth failed'", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/api/minecraft/status/route.ts", import.meta.url), "utf8");
  assert.match(src, /reason instanceof Error && rconResult\.reason\.message === "rcon auth failed"/);
});
