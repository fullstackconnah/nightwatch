import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SignJWT, type JWTPayload } from "jose";
import {
  createKioskElevationToken,
  createOidcFlowToken,
  createSessionToken,
  isMissingSecretError,
  isRequestAuthenticated,
  kioskElevationCookieOptions,
  secretKey,
  sessionCookieOptions,
  verifyKioskElevationToken,
  verifyOidcFlowToken,
  verifySessionToken,
} from "./auth.ts";

// Fake value only; real secrets never appear in tests.
const FAKE_SECRET = "test-only-session-secret-not-real";
const ENV_KEYS = ["SESSION_SECRET", "ADMIN_PASSWORD_HASH", "NODE_ENV"] as const;
// NODE_ENV is typed readonly; tests still need to flip it.
const env = process.env as Record<string, string | undefined>;

const nowSeconds = () => Math.floor(Date.now() / 1000);

// Signs a payload with the given secret, as the production code does (HS256).
function sign(payload: JWTPayload, secret = FAKE_SECRET, exp: number | string = "1h"): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
}

describe("auth", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.SESSION_SECRET = FAKE_SECRET;
    delete process.env.ADMIN_PASSWORD_HASH;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
  });

  describe("session token", () => {
    it("round-trips through createSessionToken and verifySessionToken", async () => {
      const token = await createSessionToken();
      assert.equal(await verifySessionToken(token), true);
    });

    it("refuses a missing or empty token", async () => {
      assert.equal(await verifySessionToken(undefined), false);
      assert.equal(await verifySessionToken(""), false);
    });

    it("refuses a token with a tampered signature", async () => {
      const [header, body, sig] = (await createSessionToken()).split(".");
      const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
      assert.equal(await verifySessionToken(`${header}.${body}.${flipped}`), false);
    });

    it("refuses a token whose payload was swapped under the original signature", async () => {
      const [header, , sig] = (await createSessionToken()).split(".");
      const forged = Buffer.from(JSON.stringify({ sub: "admin", typ: "session", iat: 1, exp: 4102444800 })).toString("base64url");
      assert.equal(await verifySessionToken(`${header}.${forged}.${sig}`), false);
    });

    it("refuses a token signed with another secret", async () => {
      const token = await sign({ sub: "admin", typ: "session" }, "another-test-secret-not-real");
      assert.equal(await verifySessionToken(token), false);
    });

    it("refuses an expired token", async () => {
      const token = await sign({ sub: "admin", typ: "session" }, FAKE_SECRET, nowSeconds() - 60);
      assert.equal(await verifySessionToken(token), false);
    });

    it("refuses a token whose subject is not admin, or whose typ is not session", async () => {
      assert.equal(await verifySessionToken(await sign({ sub: "someone", typ: "session" })), false);
      assert.equal(await verifySessionToken(await sign({ sub: "admin", typ: "kiosk" })), false);
    });

    it("refuses kiosk-elevation and oidc-flow tokens", async () => {
      assert.equal(await verifySessionToken(await createKioskElevationToken()), false);
      assert.equal(await verifySessionToken(await createOidcFlowToken({ state: "s", nonce: "n", verifier: "v" })), false);
    });
  });

  describe("kiosk elevation token", () => {
    it("round-trips through createKioskElevationToken and verifyKioskElevationToken", async () => {
      assert.equal(await verifyKioskElevationToken(await createKioskElevationToken()), true);
    });

    it("refuses a missing token, an expired token, and one without the kiosk claim", async () => {
      assert.equal(await verifyKioskElevationToken(undefined), false);
      assert.equal(await verifyKioskElevationToken(await sign({ sub: "kiosk", kiosk: true, typ: "kiosk" }, FAKE_SECRET, nowSeconds() - 60)), false);
      assert.equal(await verifyKioskElevationToken(await sign({ sub: "kiosk", typ: "kiosk" })), false);
    });

    it("a session token is not accepted as an elevation token, and the reverse", async () => {
      assert.equal(await verifyKioskElevationToken(await createSessionToken()), false);
      assert.equal(await verifySessionToken(await createKioskElevationToken()), false);
    });
  });

  describe("oidc flow token", () => {
    it("round-trips its claims and refuses a session token", async () => {
      const claims = { state: "state-value", nonce: "nonce-value", verifier: "verifier-value" };
      assert.deepEqual(await verifyOidcFlowToken(await createOidcFlowToken(claims)), claims);
      assert.equal(await verifyOidcFlowToken(await createSessionToken()), null);
    });
  });

  describe("isRequestAuthenticated", () => {
    it("a session passes any route", async () => {
      assert.equal(await isRequestAuthenticated(await createSessionToken(), undefined, "POST", "/api/anything"), true);
    });

    it("an elevated kiosk passes an allowlisted route with its method", async () => {
      assert.equal(await isRequestAuthenticated(undefined, await createKioskElevationToken(), "GET", "/api/docker/containers"), true);
    });

    it("an elevated kiosk is refused off the allowlist, and on an allowlisted path with the wrong method", async () => {
      const elevated = await createKioskElevationToken();
      assert.equal(await isRequestAuthenticated(undefined, elevated, "GET", "/api/config"), false);
      assert.equal(await isRequestAuthenticated(undefined, elevated, "DELETE", "/api/docker/containers"), false);
    });

    it("no tokens, or a kiosk token in the session slot, is refused", async () => {
      assert.equal(await isRequestAuthenticated(undefined, undefined, "GET", "/api/docker/containers"), false);
      assert.equal(await isRequestAuthenticated(await createKioskElevationToken(), undefined, "GET", "/api/config"), false);
    });
  });

  describe("cookie options", () => {
    it("session cookie is httpOnly, lax, path /, seven days, and not secure (LAN over plain HTTP)", () => {
      assert.deepEqual(sessionCookieOptions(), {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    });

    it("kiosk elevation cookie is httpOnly, lax, path /, five minutes", () => {
      assert.deepEqual(kioskElevationCookieOptions(), {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 5 * 60,
      });
    });
  });

  describe("secretKey", () => {
    const decode = () => new TextDecoder().decode(secretKey());

    it("uses SESSION_SECRET when set", () => {
      assert.equal(decode(), FAKE_SECRET);
    });

    it("never falls back to ADMIN_PASSWORD_HASH when SESSION_SECRET is empty", () => {
      process.env.SESSION_SECRET = "";
      process.env.ADMIN_PASSWORD_HASH = "fake-hash-not-real";
      env.NODE_ENV = "production";
      assert.throws(() => secretKey(), /SESSION_SECRET/);
    });

    it("falls back to the built-in dev secret outside production when both env vars are missing", () => {
      delete process.env.SESSION_SECRET;
      env.NODE_ENV = "development";
      assert.equal(decode(), "homelab-dashboard-dev-secret");
    });

    it("throws in production when both env vars are missing (fails closed)", async () => {
      delete process.env.SESSION_SECRET;
      env.NODE_ENV = "production";
      assert.throws(() => secretKey(), /SESSION_SECRET/);
      await assert.rejects(createSessionToken(), /SESSION_SECRET/);
      const forged = await sign({ sub: "admin", typ: "session" }, "homelab-dashboard-dev-secret");
      assert.equal(await verifySessionToken(forged), false);
      const forgedKiosk = await sign({ sub: "kiosk", kiosk: true, typ: "kiosk" }, "homelab-dashboard-dev-secret");
      assert.equal(await verifyKioskElevationToken(forgedKiosk), false);
      assert.equal(await isRequestAuthenticated(forged, forgedKiosk, "POST", "/api/anything"), false);
    });

    // No minimum length is enforced; a short secret is used as-is.
    it("accepts a short secret without a length check", () => {
      process.env.SESSION_SECRET = "abc";
      assert.equal(decode(), "abc");
    });
  });
});

describe("isMissingSecretError", () => {
  it("accepts what secretKey throws in production with no secret, and nothing else", () => {
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD_HASH;
    env.NODE_ENV = "production";
    try {
      assert.throws(() => secretKey(), (e) => isMissingSecretError(e));
    } finally {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else env[k] = saved[k];
      }
    }
    assert.equal(isMissingSecretError(new Error("disk full")), false);
    assert.equal(isMissingSecretError("SESSION_SECRET"), false);
  });
});
