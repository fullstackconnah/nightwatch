import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { postLoginPath, shouldRedirectToLogin } from "./login-redirect.ts";

test("a 401 sends dashboard paths to /login but never the kiosk", () => {
  assert.equal(shouldRedirectToLogin("/"), true);
  assert.equal(shouldRedirectToLogin("/hermes"), true);
  assert.equal(shouldRedirectToLogin("/kiosk"), false);
  assert.equal(shouldRedirectToLogin("/kiosk/x"), false);
  assert.equal(shouldRedirectToLogin("/kiosked"), true);
});

test("the shared fetcher asks the helper before navigating", () => {
  const src = readFileSync(fileURLToPath(new URL("./client.ts", import.meta.url)), "utf8");
  assert.match(src, /^\s+if \(shouldRedirectToLogin\(window\.location\.pathname\)\) window\.location\.href = "\/login";\s*$/m);
});

test("a plain page anchor survives the password login, anything else lands on /", () => {
  assert.equal(postLoginPath("#backup"), "/#backup");
  assert.equal(postLoginPath("#a-1"), "/#a-1");
  for (const bad of ["", "#", "#a b", "#Backup", '#x"y', "#/x", "#//evil.example", "#backup\n", "http://a", "javascript:x", "//evil.example", "/x"]) {
    assert.equal(postLoginPath(bad), "/", JSON.stringify(bad));
  }
});

test("the login form sends the user to the helper's path", () => {
  const src = readFileSync(fileURLToPath(new URL("../app/login/login-form.tsx", import.meta.url)), "utf8");
  assert.match(src, /window\.location\.href = postLoginPath\(window\.location\.hash\);/);
});
