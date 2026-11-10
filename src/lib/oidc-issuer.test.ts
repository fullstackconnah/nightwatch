import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sameIssuer } from "./oidc-issuer.ts";

test("a provider issuer with a trailing slash matches the saved one, slash or not", () => {
  assert.equal(sameIssuer("https://idp.example/application/o/app/", "https://idp.example/application/o/app"), true);
  assert.equal(sameIssuer("https://idp.example/application/o/app", "https://idp.example/application/o/app"), true);
  assert.equal(sameIssuer("https://idp.example/application/o/app/", "https://idp.example/application/o/app/"), true);
});

test("a different host, path, scheme or case is still a mismatch", () => {
  assert.equal(sameIssuer("https://evil.example/application/o/app/", "https://idp.example/application/o/app"), false);
  assert.equal(sameIssuer("https://idp.example/application/o/other/", "https://idp.example/application/o/app"), false);
  assert.equal(sameIssuer("http://idp.example/application/o/app", "https://idp.example/application/o/app"), false);
  assert.equal(sameIssuer("https://IDP.example/application/o/app", "https://idp.example/application/o/app"), false);
});

test("oidc.ts uses sameIssuer for the discovery check and keeps the id token iss strict", () => {
  // oidc.ts imports through the @/ alias, which node:test cannot load: scan the source.
  const src = readFileSync(new URL("./oidc.ts", import.meta.url), "utf8");
  assert.match(src, /^\s*if \(!sameIssuer\(doc\.issuer, issuer\)\) \{/m);
  assert.match(src, /^\s*issuer: doc\.issuer,/m);
});
