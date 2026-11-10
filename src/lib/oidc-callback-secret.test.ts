import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/api/auth/oidc/callback/route.ts", import.meta.url), "utf8");

test("the OIDC callback turns a missing SESSION_SECRET into the config sign-in error, not a 500", () => {
  assert.match(src, /^\s*if \(!isMissingSecretError\(e\)\) throw e;/m);
  assert.match(src, /^\s*return ssoErrorRedirect\(req, "config"\);/m);
  assert.match(src, /^\s*token = await createSessionToken\(\);/m);
});
