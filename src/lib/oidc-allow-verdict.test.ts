import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as allow from "./oidc-allow.ts";

const quiet = { warn() {}, error() {} };
const verdict = (list: string | undefined, problem: string | null) => allow.oidcAllowVerdict({ sub: "x" }, list, quiet, problem);

describe("oidcAllowVerdict: why SSO refused", () => {
  it("an empty list with a config problem is `settings` (the saved settings cannot be read)", () => {
    for (const problem of ["blank", "unreadable", "unreadable-no-copy"]) {
      assert.equal(verdict(undefined, problem), "settings");
      assert.equal(verdict(" , ", problem), "settings");
    }
  });
  it("a non-empty list that lacks the account is `denied`, with or without a problem", () => {
    assert.equal(verdict("y", "unreadable"), "denied");
    assert.equal(verdict("y", null), "denied");
  });
  it("an account on the list, or an empty list with no problem, is `allowed`", () => {
    assert.equal(verdict("x", "unreadable"), "allowed");
    assert.equal(verdict(undefined, null), "allowed");
  });
  it("oidcAllowDecision stays the boolean of the same verdict", () => {
    assert.equal(allow.oidcAllowDecision({ sub: "x" }, undefined, quiet, "blank"), false);
    assert.equal(allow.oidcAllowDecision({ sub: "x" }, "x", quiet, "blank"), true);
  });
});
