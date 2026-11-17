import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createKioskElevationToken, createOidcFlowToken, createSessionToken, secretKey, verifySessionToken } from "./auth.ts";

// Full admin session only: typ "session" is required, so kiosk and oidc-flow tokens (same secret) are refused.
const uploadAuthorized = verifySessionToken;

test("no cookie is unauthorized", async () => {
  assert.equal(await uploadAuthorized(undefined, 0), false);
});

test("garbage cookie is unauthorized", async () => {
  assert.equal(await uploadAuthorized("not-a-jwt", 0), false);
});

test("valid session token is authorized", async () => {
  assert.equal(await uploadAuthorized(await createSessionToken(0), 0), true);
});

test("kiosk elevation token presented as the session cookie is unauthorized", async () => {
  assert.equal(await uploadAuthorized(await createKioskElevationToken(0, "test-tag"), 0), false);
});

test("oidc-flow token presented as the session cookie is unauthorized", async () => {
  const token = await createOidcFlowToken({ state: "s", nonce: "n", verifier: "v" });
  assert.equal(await uploadAuthorized(token, 0), false);
});

test("token signed with the secret but without typ is unauthorized", async () => {
  const token = await new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("60s")
    .sign(secretKey());
  assert.equal(await uploadAuthorized(token, 0), false);
});
