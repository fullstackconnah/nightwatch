import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("the `settings` SSO error code", () => {
  it("the login page whitelists it and the form says exactly why SSO is off", () => {
    assert.match(read("../app/login/page.tsx"), /new Set\(\[[^\]]*"settings"[^\]]*\]\)/);
    assert.ok(
      read("../app/login/login-form.tsx").includes(
        `settings: "The saved settings can't be read, so SSO sign-in is off until they are restored."`,
      ),
    );
  });
  it("the copy leaks no path, problem kind or file name", () => {
    const m = /settings: "([^"]*)"/.exec(read("../app/login/login-form.tsx"));
    assert.ok(m);
    assert.doesNotMatch(m[1], /config\.json|data\/|unreadable|blank/i);
  });
  it("the callback redirects with the verdict, so only the unreadable-settings refusal reads `settings`", () => {
    const src = read("../app/api/auth/oidc/callback/route.ts");
    assert.match(src, /"settings"/);
    assert.match(src, /const verdict = oidcAllowListCheck\([^)]*\);\s*if \(verdict !== "allowed"\) return ssoErrorRedirect\(req, verdict\);/);
  });
});
