import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createKioskElevationToken, createOidcFlowToken, createSessionToken } from "./auth.ts";
import { kioskMayCall } from "./kiosk-access.ts";
import { verifySessionToken as fullSessionAllowed } from "./auth.ts";

// The kiosk elevation cookie is deliberately ignored: the orchestra routes control the owner's PC.
describe("verifySessionToken (orchestra guard)", () => {
  it("allows a real session token only", async () => {
    assert.equal(await fullSessionAllowed(await createSessionToken(0), 0), true);
    assert.equal(await fullSessionAllowed(await createKioskElevationToken(), 0), false);
    assert.equal(await fullSessionAllowed(await createOidcFlowToken({ state: "s", nonce: "n", verifier: "v" }), 0), false);
    assert.equal(await fullSessionAllowed(undefined, 0), false);
  });
});

describe("kiosk elevation allowlist", () => {
  it("never reaches the orchestra routes", () => {
    for (const m of ["GET", "POST", "PUT", "DELETE"])
      for (const p of ["/api/orchestra/status", "/api/orchestra/orchestrators/dev", "/orchestrators"])
        assert.equal(kioskMayCall(m, p), false, `${m} ${p}`);
  });
});
