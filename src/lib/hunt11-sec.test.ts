import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { secretForUrl } from "./settings/dash-put.ts";
import { protectedActionRefused } from "./protected-containers.ts";
import { packFieldsError } from "./minecraft/pack-check.ts";

describe("A1 secretForUrl (Hermes token and OIDC client secret)", () => {
  const old = "https://hermes.example/v1";
  it("keeps on an unchanged url or a path change", () => {
    assert.equal(secretForUrl("fake-token", old, old), "fake-token");
    assert.equal(secretForUrl("fake-token", old, "https://hermes.example/other"), "fake-token");
  });
  it("drops on an origin change or a removed url", () => {
    assert.equal(secretForUrl("fake-token", old, "https://other.example/v1"), undefined);
    assert.equal(secretForUrl("fake-token", old, "http://hermes.example/v1"), undefined);
    assert.equal(secretForUrl("fake-token", old, ""), undefined);
  });
  it("keeps when no url was ever set and none is set now", () => {
    assert.equal(secretForUrl("fake-token", undefined, ""), "fake-token");
  });
  it("the system route feeds both secrets through it, then a typed value still wins", () => {
    const src = readFileSync(new URL("../app/api/settings/system/route.ts", import.meta.url), "utf8");
    assert.match(src, /mergedSecret\(str\(body\.hermesApiToken\), secretForUrl\(existing\.hermesApiToken, existing\.hermesApiUrl, hermesApiUrl\)\)/);
    assert.match(src, /mergedSecret\(str\(body\.oidcClientSecret\), secretForUrl\(existing\.oidcClientSecret, existing\.oidcIssuer, oidcIssuer\)\)/);
  });
});

describe("X1 protectedActionRefused", () => {
  it("kiosk plus protected: restart refused, start allowed", () => {
    assert.equal(protectedActionRefused("restart", false, true), true);
    assert.equal(protectedActionRefused("start", false, true), false);
  });
  it("full plus protected: restart allowed, stop refused", () => {
    assert.equal(protectedActionRefused("restart", true, true), false);
    assert.equal(protectedActionRefused("stop", true, true), true);
  });
  it("kiosk plus unprotected: restart allowed", () => {
    assert.equal(protectedActionRefused("restart", false, false), false);
  });
  it("the route asks with the session cookie", () => {
    const src = readFileSync(new URL("../app/api/docker/containers/[id]/action/route.ts", import.meta.url), "utf8");
    assert.match(src, /verifySessionToken\(req\.cookies\.get\(SESSION_COOKIE\)\?\.value\)/);
  });
});

describe("C3 packFieldsError", () => {
  const ok = { name: "Pack", pageUrl: "https://www.curseforge.com/minecraft/modpacks/x", mcVersion: "1.20.1" };
  it("accepts curseforge, modrinth, a null or absent version", () => {
    assert.equal(packFieldsError(ok), null);
    assert.equal(packFieldsError({ ...ok, pageUrl: "https://modrinth.com/modpack/x", mcVersion: null }), null);
    assert.equal(packFieldsError({ name: "Pack", pageUrl: "https://curseforge.com/a" }), null);
  });
  it("rejects other schemes and hosts", () => {
    for (const pageUrl of ["http://curseforge.com/a", "https://evilcurseforge.com/a", "https://curseforge.com.evil.example/a", "javascript:alert(1)", "nope"]) {
      assert.ok(packFieldsError({ ...ok, pageUrl }), pageUrl);
    }
  });
  it("rejects an overlong name and a bad version", () => {
    assert.ok(packFieldsError({ ...ok, name: "a".repeat(201) }));
    assert.equal(packFieldsError({ ...ok, name: "a".repeat(200) }), null);
    for (const mcVersion of ["", "v1", "1.20; rm", "1".repeat(33), 5]) assert.ok(packFieldsError({ ...ok, mcVersion }), String(mcVersion));
  });
});
