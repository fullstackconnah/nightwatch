import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Source scans: the routes import the "@/" alias, which node:test cannot load (hunt 7 B1, B3, B5-B8).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("hunt 7 settings and auth wiring", () => {
  it("B1: login and the password check each use a limiter (the password check, shared with the system route, via step-up.ts)", () => {
    const login = read("../app/api/auth/login/route.ts");
    const pw = read("../app/api/settings/password/route.ts");
    const step = read("./step-up.ts");
    for (const src of [login, pw]) assert.ok(src.includes('status: 429'));
    assert.ok(login.includes("createAttemptLimiter()"));
    assert.ok(pw.includes("currentPasswordLimiter") && step.includes("createAttemptLimiter()"));
    assert.ok(!login.includes("lockedUntil"));
    assert.ok(step.includes("limiter.reset()"));
    // only a request that reaches the compare uses up an attempt
    assert.ok(pw.indexOf("Current password is required") < pw.indexOf("checkCurrentPassword("));
    assert.ok(step.indexOf("if (!password)") < step.indexOf("limiter.attempt()"));
    assert.ok(step.indexOf("limiter.attempt()") < step.indexOf("matchesAny("));
    for (const src of [login, step]) {
      assert.ok(src.includes("limiter.attempt()") && !src.includes("limiter.fail()") && !src.includes("isLocked"));
      // the count and the check are one synchronous statement
      assert.ok(src.split(/\r?\n/).every((l) => !l.includes("limiter.attempt()") || !l.includes("await")));
    }
  });
  it("B3 B5: system route checks the token length and every URL field", () => {
    const src = read("../app/api/settings/system/route.ts");
    assert.ok(src.includes("mcpTokenError(typedMcpToken)"));
    for (const f of ["hermesApiUrl", "voiceServerUrl", "voiceTtsUrl", "oidcIssuer"]) assert.ok(src.includes(`httpUrlError("${f}"`), f);
  });
  it("B5: orchestra settings reuse the shared URL check", () => {
    assert.ok(read("./orchestra-settings.ts").includes('httpUrlError("orchestraUrl"'));
  });
  it("B6: integrations route checks port, host and URLs", () => {
    const src = read("../app/api/settings/integrations/route.ts");
    assert.ok(src.includes("rconPortError(") && src.includes("rconHostError("));
    for (const f of ["Home Assistant URL", "NPM URL", "Forgejo URL", "managerUrl"]) assert.ok(src.includes(`httpUrlError("${f}"`), f);
  });
  it("B7: pins are normalised, bounded and capped", () => {
    const src = read("../app/api/resources/pins/route.ts");
    assert.ok(src.includes("resolveAbsolutePath(") && src.includes("applyPin(") && src.includes("MAX_PIN_PATH"));
  });
  it("B8: hermes daemon route bounds the budget and requires an https webhook", () => {
    const src = read("../app/api/settings/hermes-daemon/route.ts");
    assert.ok(src.includes("budgetChangeError(") && src.includes("webhookError("));
  });
});
