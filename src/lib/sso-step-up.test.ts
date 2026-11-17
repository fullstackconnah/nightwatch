import assert from "node:assert/strict";
import { test } from "node:test";
import { ssoStepUpPending } from "./sso-step-up.ts";

const stored = { oidcIssuer: "https://sso.example", oidcClientId: "nightwatch" };
const same = { issuer: "https://sso.example", clientId: "nightwatch", clientSecret: "" };

test("an untouched form asks for no password", () => {
  assert.equal(ssoStepUpPending(same, stored), false);
});

test("a whitespace-only secret is not a protected change (the server trims it away)", () => {
  assert.equal(ssoStepUpPending({ ...same, clientSecret: "   \t" }, stored), false);
});

test("a typed secret, or a changed issuer or client id, is", () => {
  assert.equal(ssoStepUpPending({ ...same, clientSecret: " s3cret " }, stored), true);
  assert.equal(ssoStepUpPending({ ...same, issuer: "https://other.example" }, stored), true);
  assert.equal(ssoStepUpPending({ ...same, clientId: "x" }, stored), true);
});

test("nothing stored and nothing typed is no change", () => {
  assert.equal(ssoStepUpPending({ issuer: "", clientId: "", clientSecret: "" }, {}), false);
});
