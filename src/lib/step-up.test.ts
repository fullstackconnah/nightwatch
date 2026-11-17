import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCurrentPassword, stepUpNeeded } from "./step-up.ts";

const none = { oidcIssuer: undefined, oidcClientId: undefined };
const sso = { oidcIssuer: "https://sso.example", oidcClientId: "cid" };

describe("stepUpNeeded", () => {
  it("generate, clear and a typed MCP token each need it", () => {
    assert.equal(stepUpNeeded({ generateMcpToken: true }, none), true);
    assert.equal(stepUpNeeded({ clearMcpToken: true }, none), true);
    assert.equal(stepUpNeeded({ typedMcpToken: "x".repeat(32) }, none), true);
  });
  it("a typed PIN or secret needs it even when equal to the stored one (no oracle)", () => {
    assert.equal(stepUpNeeded({ typedKioskPin: "1234" }, none), true);
    assert.equal(stepUpNeeded({ typedOidcClientSecret: "s" }, none), true);
  });
  it("the clear flags need it", () => {
    assert.equal(stepUpNeeded({ clearKioskPin: true }, none), true);
    assert.equal(stepUpNeeded({ clearOidcClientSecret: true }, none), true);
  });
  it("a whitespace-only (so trimmed-empty) PIN, secret or token is not a protected change", () => {
    assert.equal(stepUpNeeded({ typedKioskPin: "", typedOidcClientSecret: "", typedMcpToken: "" }, none), false);
    assert.equal(stepUpNeeded({ typedKioskPin: undefined, typedOidcClientSecret: undefined }, none), false);
  });
  it("an unchanged SSO resend does not, and undefined equals the empty string", () => {
    assert.equal(stepUpNeeded({ oidcIssuer: sso.oidcIssuer, oidcClientId: sso.oidcClientId }, sso), false);
    assert.equal(stepUpNeeded({ oidcIssuer: "", oidcClientId: "" }, none), false);
  });
  it("an issuer change, a client id change and an issuer clear need it", () => {
    assert.equal(stepUpNeeded({ oidcIssuer: "https://other.example", oidcClientId: "cid" }, sso), true);
    assert.equal(stepUpNeeded({ oidcIssuer: sso.oidcIssuer, oidcClientId: "other" }, sso), true);
    assert.equal(stepUpNeeded({ oidcIssuer: "", oidcClientId: "cid" }, sso), true);
  });
  it("a body with none of those (voice, Hermes, orchestra) does not", () => {
    assert.equal(stepUpNeeded({}, sso), false);
    assert.equal(stepUpNeeded({ oidcIssuer: sso.oidcIssuer }, sso), false);
  });
});

function deps(over: { attempt?: boolean; match?: boolean } = {}) {
  const calls = { attempt: 0, reset: 0, compare: 0, wait: 0 };
  return {
    calls,
    deps: {
      limiter: { attempt: () => (calls.attempt++, over.attempt ?? true), reset: () => void calls.reset++ },
      compare: async () => (calls.compare++, over.match ?? true),
      wait: async () => void calls.wait++,
    },
  };
}

describe("checkCurrentPassword", () => {
  it("none when no hashes, using no attempt", async () => {
    const d = deps();
    assert.equal(await checkCurrentPassword("pw", [], d.deps), "none");
    assert.equal(d.calls.attempt, 0);
  });
  it("missing on blank without calling limiter.attempt", async () => {
    const d = deps();
    assert.equal(await checkCurrentPassword("", ["h"], d.deps), "missing");
    assert.equal(d.calls.attempt + d.calls.compare, 0);
  });
  it("wrong waits once and does not reset", async () => {
    const d = deps({ match: false });
    assert.equal(await checkCurrentPassword("pw", ["h"], d.deps), "wrong");
    assert.deepEqual([d.calls.wait, d.calls.reset], [1, 0]);
  });
  it("ok resets the limiter and does not wait", async () => {
    const d = deps();
    assert.equal(await checkCurrentPassword("pw", ["h"], d.deps), "ok");
    assert.deepEqual([d.calls.wait, d.calls.reset], [0, 1]);
  });
  it("limited when attempt() is false and compare is never called", async () => {
    const d = deps({ attempt: false });
    assert.equal(await checkCurrentPassword("pw", ["h"], d.deps), "limited");
    assert.equal(d.calls.compare, 0);
  });
});

describe("shared limiter", () => {
  it("survives a second module instance (one on globalThis)", async () => {
    const a = await import("./step-up.ts?a");
    const b = await import("./step-up.ts?b");
    assert.notEqual(a.checkCurrentPassword, b.checkCurrentPassword);
    assert.equal(a.currentPasswordLimiter, b.currentPasswordLimiter);
    assert.equal((globalThis as Record<string, unknown>).__nwStepUpLimiter, a.currentPasswordLimiter);
  });
  it("attempts through one instance count against the other", () => {
    return Promise.all([import("./step-up.ts?c"), import("./step-up.ts?d")]).then(([c, d]) => {
      c.currentPasswordLimiter.reset();
      for (let i = 0; i < 5; i++) assert.equal(c.currentPasswordLimiter.attempt(), true);
      assert.equal(d.currentPasswordLimiter.attempt(), false);
      d.currentPasswordLimiter.reset();
    });
  });
});
