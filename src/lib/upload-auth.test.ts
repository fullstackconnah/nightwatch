import { test } from "node:test";
import assert from "node:assert/strict";
import { createKioskElevationToken, createSessionToken } from "./auth.ts";
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
