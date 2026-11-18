import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("PR A: OIDC allow-list wiring", () => {
  it("the callback checks the allow-list after verifyIdToken and before createSessionToken, refusing as denied", () => {
    const src = read("app/api/auth/oidc/callback/route.ts");
    const verify = src.indexOf("verifyIdToken(idToken");
    const check = src.indexOf("oidcAllowListCheck(");
    const mint = src.indexOf("createSessionToken(");
    assert.ok(verify > 0 && check > verify && mint > check);
    assert.match(src, /const verdict = oidcAllowListCheck\([^)]*\);\s*if \(verdict !== "allowed"\) return ssoErrorRedirect\(req, verdict\);/);
  });
  it("a System-card save keeps the stored allow-list (it spreads ...existing into system)", () => {
    assert.match(read("app/api/settings/system/route.ts"), /system: \{\s*\.\.\.existing,/);
  });
  it("the Settings GET whitelist does not list the allow-list", () => {
    const m = /export function publicSystem[\s\S]*?\n\}/.exec(read("lib/orchestra-settings.ts"));
    assert.ok(m);
    assert.ok(!m[0].includes("oidcAllowedUsers"));
  });
});

describe("PR A: Secure cookies behind TLS", () => {
  const setters = [
    "app/api/auth/login/route.ts",
    "app/api/auth/oidc/callback/route.ts",
    "app/api/auth/oidc/login/route.ts",
    "app/api/auth/kiosk/route.ts",
    "app/api/auth/kiosk/refresh/route.ts",
  ];
  for (const f of setters) {
    it(`${f} passes isSecureRequest(req) to its cookie options`, () => {
      assert.match(read(f), /CookieOptions\(isSecureRequest\(req\)\)/);
    });
  }
  it("auth.ts and oidc.ts no longer hard-code secure: false", () => {
    assert.ok(!read("lib/auth.ts").includes("secure: false"));
    assert.ok(!read("lib/oidc.ts").includes("secure: false"));
  });
});
