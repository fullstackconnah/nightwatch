import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantSay, loginFailure, loginUnreachable, versionBuildId } from "./client-replies.ts";

test("assistant: a non-blank say is kept, a blank or missing one throws", () => {
  assert.equal(assistantSay({ say: "Too many requests." }), "Too many requests.");
  for (const r of [{}, { say: "" }, { say: "   " }, { say: 5 }]) assert.throws(() => assistantSay(r), /bad assistant reply/);
});

test("version check: an error reply or a missing buildId throws instead of reading as a new build", () => {
  assert.equal(versionBuildId(true, { buildId: "abc" }), "abc");
  assert.throws(() => versionBuildId(false, { buildId: "abc" }), /bad version reply/);
  assert.throws(() => versionBuildId(true, {}), /bad version reply/);
});

test("login: a non-JSON error body (empty object) shows Login failed, a server error is kept", () => {
  assert.equal(loginFailure({}), "Login failed");
  assert.equal(loginFailure({ error: "" }), "Login failed");
  assert.equal(loginFailure({ error: "Wrong password" }), "Wrong password");
});

test("login: a JSON null (or other non-object) reply gives the generic text and does not throw", () => {
  assert.equal(loginFailure(null), loginFailure({}));
  assert.equal(loginFailure(undefined), "Login failed");
  assert.equal(loginFailure("oops"), "Login failed");
});

test("login: any thrown fetch value gives the fixed offline copy, never the raw text", () => {
  const copy = "Can't reach nightwatch. Check the connection and try again.";
  for (const e of [new TypeError("Failed to fetch"), new TypeError("Load failed"), "boom", undefined]) assert.equal(loginUnreachable(e), copy);
});
