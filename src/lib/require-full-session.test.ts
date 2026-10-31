import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createKioskElevationToken, createOidcFlowToken, createSessionToken } from "./auth.ts";
import { kioskMayCall } from "./kiosk-access.ts";
import { fullSessionAllowed } from "./require-full-session.ts";

describe("fullSessionAllowed", () => {
  it("allows a real session token only", async () => {
    assert.equal(await fullSessionAllowed(await createSessionToken()), true);
    assert.equal(await fullSessionAllowed(await createKioskElevationToken()), false);
    assert.equal(await fullSessionAllowed(await createOidcFlowToken({ state: "s", nonce: "n", verifier: "v" })), false);
    assert.equal(await fullSessionAllowed(undefined), false);
  });
});

describe("kiosk elevation allowlist", () => {
  it("never reaches the orchestra routes", () => {
    for (const m of ["GET", "POST", "PUT", "DELETE"])
      for (const p of ["/api/orchestra/status", "/api/orchestra/orchestrators/dev", "/orchestrators"])
        assert.equal(kioskMayCall(m, p), false, `${m} ${p}`);
  });
});
