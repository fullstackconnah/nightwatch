import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as reason from "./login-reason.ts";

describe("loginFailReason: the 401 text", () => {
  it("no hash anywhere and the saved settings cannot be read: says so, not 'No admin password'", () => {
    assert.equal(
      reason.loginFailReason(false, "unreadable"),
      "The saved settings can't be read, so password sign-in is off until they are restored.",
    );
  });
  it("no hash anywhere and the settings read fine: unchanged", () => {
    assert.equal(reason.loginFailReason(false, null), "No admin password is configured — login disabled");
  });
  it("a hash exists (wrong password): unchanged, whatever the settings problem", () => {
    assert.equal(reason.loginFailReason(true, null), "Wrong password");
    assert.equal(reason.loginFailReason(true, "unreadable"), "Wrong password");
  });
  it("the route builds its 401 text from it, in the no-candidates-and-not-development branch only", () => {
    const src = readFileSync(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
    assert.match(src, /configProblem/);
    assert.match(src, /loginFailReason\(/);
    assert.ok(!src.includes("No admin password is configured"), "the copy lives in login-reason.ts");
  });
});
