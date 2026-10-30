import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createKioskElevationToken, createSessionToken, isRequestAuthenticated } from "./auth.ts";
import { kioskMayCall } from "./kiosk-access.ts";

describe("kioskMayCall (what an elevated kiosk may reach)", () => {
  it("allows the container list, lifecycle action and voice calls the kiosk makes", () => {
    assert.ok(kioskMayCall("GET", "/api/docker/containers"));
    assert.ok(kioskMayCall("POST", "/api/docker/containers/abc123def456/action"));
    assert.ok(kioskMayCall("GET", "/api/voice/status"));
    assert.ok(kioskMayCall("POST", "/api/voice/transcribe"));
    assert.ok(kioskMayCall("POST", "/api/voice/speak"));
  });

  it("refuses everything else, including wrong methods on allowed paths", () => {
    assert.ok(!kioskMayCall("GET", "/api/settings/system"));
    assert.ok(!kioskMayCall("PUT", "/api/settings/system"));
    assert.ok(!kioskMayCall("POST", "/api/docker/prune"));
    assert.ok(!kioskMayCall("POST", "/api/docker/containers")); // create
    assert.ok(!kioskMayCall("DELETE", "/api/docker/containers/abc"));
    assert.ok(!kioskMayCall("GET", "/api/docker/containers/abc/logs"));
    assert.ok(!kioskMayCall("GET", "/api/docker/containers/abc/action"));
    assert.ok(!kioskMayCall("POST", "/api/docker/containers/a/b/action"));
    assert.ok(!kioskMayCall("DELETE", "/api/docker/images/abc"));
    assert.ok(!kioskMayCall("GET", "/settings"));
    assert.ok(!kioskMayCall("GET", "/"));
  });
});

describe("isRequestAuthenticated", () => {
  it("a session cookie passes every route", async () => {
    const session = await createSessionToken();
    for (const [m, p] of [["GET", "/api/settings/system"], ["POST", "/api/docker/prune"], ["GET", "/settings"]]) {
      assert.ok(await isRequestAuthenticated(session, undefined, m, p));
    }
  });

  it("an elevation cookie passes only the kiosk allowlist", async () => {
    const kiosk = await createKioskElevationToken();
    assert.ok(await isRequestAuthenticated(undefined, kiosk, "POST", "/api/docker/containers/abc/action"));
    assert.ok(!(await isRequestAuthenticated(undefined, kiosk, "GET", "/api/settings/system")));
    assert.ok(!(await isRequestAuthenticated(undefined, kiosk, "POST", "/api/docker/prune")));
    assert.ok(!(await isRequestAuthenticated(undefined, kiosk, "GET", "/settings")));
  });

  it("no cookie passes nothing", async () => {
    assert.ok(!(await isRequestAuthenticated(undefined, undefined, "GET", "/api/docker/containers")));
  });
});
