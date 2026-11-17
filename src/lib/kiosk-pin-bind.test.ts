import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SignJWT } from "jose";
import {
  createKioskElevationToken,
  isRequestAuthenticated,
  kioskPinTag,
  verifyKioskElevationToken,
} from "./auth.ts";

const SECRET = "test-only-kiosk-pin-bind-secret";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved;
});

describe("kioskPinTag", () => {
  it("is stable, differs per PIN, is 16 hex characters and hides the PIN", async () => {
    const a = await kioskPinTag("482913");
    assert.equal(a, await kioskPinTag("482913"));
    assert.notEqual(a, await kioskPinTag("482914"));
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.ok(!a.includes("482913"));
  });
  it("is empty for no PIN, and keyed by the secret", async () => {
    assert.equal(await kioskPinTag(undefined), "");
    assert.equal(await kioskPinTag(""), "");
    const a = await kioskPinTag("482913");
    process.env.SESSION_SECRET = "another-test-only-secret";
    assert.notEqual(a, await kioskPinTag("482913"));
  });
});

describe("a kiosk elevation is bound to the PIN tag", () => {
  it("verifies with its own tag only", async () => {
    const tagA = await kioskPinTag("111111");
    const tagB = await kioskPinTag("222222");
    const t = await createKioskElevationToken(0, tagA);
    assert.equal(await verifyKioskElevationToken(t, 0, tagA), true);
    assert.equal(await verifyKioskElevationToken(t, 0, tagB), false);
    assert.equal(await verifyKioskElevationToken(t, 0, ""), false);
  });
  it("refuses a token minted without a tag claim, even for an empty tag", async () => {
    const old = await new SignJWT({ sub: "kiosk", kiosk: true, typ: "kiosk", ep: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(SECRET));
    assert.equal(await verifyKioskElevationToken(old, 0, await kioskPinTag("111111")), false);
    assert.equal(await verifyKioskElevationToken(old, 0, ""), false);
  });
  it("isRequestAuthenticated passes a kiosk path with the matching tag and fails once the tag changes", async () => {
    const tagA = await kioskPinTag("111111");
    const t = await createKioskElevationToken(0, tagA);
    assert.equal(await isRequestAuthenticated(undefined, t, "GET", "/api/docker/containers", 0, tagA), true);
    assert.equal(await isRequestAuthenticated(undefined, t, "GET", "/api/docker/containers", 0, await kioskPinTag("222222")), false);
  });
});
