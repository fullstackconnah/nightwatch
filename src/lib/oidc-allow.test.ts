import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { oidcLoginAllowed, oidcAllowDecision, resetOidcAllowWarning } from "./oidc-allow.ts";

const open = { allowed: true, open: true };

describe("oidcLoginAllowed", () => {
  it("an unset, empty or separator-only list admits everyone and reports open", () => {
    for (const raw of [undefined, "", " , ", " \n ,, "]) assert.deepEqual(oidcLoginAllowed({ sub: "x" }, raw), open);
  });
  it("a sub must match exactly", () => {
    assert.equal(oidcLoginAllowed({ sub: "abc-123" }, "abc-123").allowed, true);
    assert.equal(oidcLoginAllowed({ sub: "ABC-123" }, "abc-123").allowed, false);
    assert.equal(oidcLoginAllowed({ sub: "abc" }, "abc-123").allowed, false);
    assert.equal(oidcLoginAllowed({ sub: "abc-123" }, "abc-123").open, false);
  });
  it("an email matches case-insensitively only when email_verified is boolean true", () => {
    const list = "Owner@Example.com";
    assert.equal(oidcLoginAllowed({ sub: "z", email: "owner@example.com", email_verified: true }, list).allowed, true);
    for (const ev of [undefined, false, "true", 1]) {
      assert.equal(oidcLoginAllowed({ sub: "z", email: "owner@example.com", email_verified: ev }, list).allowed, false);
    }
  });
  it("entries split on commas and whitespace and are trimmed", () => {
    for (const s of ["b", "c"]) assert.equal(oidcLoginAllowed({ sub: s }, "a, b\n c").allowed, true);
    assert.equal(oidcLoginAllowed({ sub: "d" }, "a, b\n c").allowed, false);
  });
  it("either route admits: verified email with a different sub, sub with no email", () => {
    assert.equal(oidcLoginAllowed({ sub: "other", email: "a@b.c", email_verified: true }, "a@b.c").allowed, true);
    assert.equal(oidcLoginAllowed({ sub: "s1" }, "a@b.c, s1").allowed, true);
  });
  it("a non-string sub, or no sub and no verified email, is refused", () => {
    assert.equal(oidcLoginAllowed({ sub: 123 }, "123").allowed, false);
    assert.equal(oidcLoginAllowed({}, "x").allowed, false);
  });
});

describe("oidcAllowDecision (logging)", () => {
  let warns: string[];
  let logs: string[];
  beforeEach(() => {
    resetOidcAllowWarning();
    warns = [];
    logs = [];
  });
  const sink = { warn: (m: string) => warns.push(m), error: (m: string) => logs.push(m) };

  it("an open list warns once per process", () => {
    assert.equal(oidcAllowDecision({ sub: "x" }, undefined, sink), true);
    assert.equal(oidcAllowDecision({ sub: "y" }, " ", sink), true);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /allow-list/);
  });
  it("a refusal logs the quoted sub cut to 80 chars, never the email", () => {
    const long = "s".repeat(200);
    assert.equal(oidcAllowDecision({ sub: long, email: "me@example.com", email_verified: true }, "other", sink), false);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes(JSON.stringify("s".repeat(80))));
    assert.ok(!logs[0].includes("s".repeat(81)));
    assert.ok(!logs[0].includes("me@example.com"));
    assert.match(logs[0], /the allow-list/);
  });
  it("a sub with quotes or newlines is logged JSON-escaped", () => {
    oidcAllowDecision({ sub: 'a"\nb' }, "other", sink);
    assert.ok(logs[0].includes(JSON.stringify('a"\nb')));
  });
  it("an admitted login logs nothing", () => {
    oidcAllowDecision({ sub: "a" }, "a", sink);
    assert.deepEqual([warns, logs], [[], []]);
  });
});
