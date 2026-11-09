import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shouldRedirectToLogin } from "./login-redirect.ts";

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
