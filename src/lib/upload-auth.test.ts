import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createKioskElevationToken, createOidcFlowToken, createSessionToken, secretKey } from "./auth.ts";
import { uploadAuthorized } from "./upload-auth.ts";

test("no cookie is unauthorized", async () => {
  assert.equal(await uploadAuthorized(undefined), false);
});

test("garbage cookie is unauthorized", async () => {
  assert.equal(await uploadAuthorized("not-a-jwt"), false);
});

test("valid session token is authorized", async () => {
  assert.equal(await uploadAuthorized(await createSessionToken()), true);
});

test("kiosk elevation token presented as the session cookie is unauthorized", async () => {
  assert.equal(await uploadAuthorized(await createKioskElevationToken()), false);
});

test("oidc-flow token presented as the session cookie is unauthorized", async () => {
  const token = await createOidcFlowToken({ state: "s", nonce: "n", verifier: "v" });
  assert.equal(await uploadAuthorized(token), false);
});

test("token signed with the secret but without typ is unauthorized", async () => {
  const token = await new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("60s")
    .sign(secretKey());
  assert.equal(await uploadAuthorized(token), false);
});
