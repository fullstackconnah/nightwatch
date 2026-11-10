import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkedIssuer, sameIssuer } from "./oidc-issuer.ts";

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

test("oidcConfig runs the saved-issuer URL check on the env fallback too and turns SSO off on an error", () => {
  const src = readFileSync(new URL("./oidc.ts", import.meta.url), "utf8");
  assert.match(src, /^\s*if \("error" in checked\) \{/m);
});

test("checkedIssuer refuses a login in the URL and never echoes it", () => {
  const r = checkedIssuer("https://u:p@auth.example");
  assert.ok("error" in r);
  assert.ok(!r.error.includes("u:p"));
});

test("checkedIssuer refuses a query and a fragment", () => {
  assert.ok("error" in checkedIssuer("https://auth.example/app?x=1"));
  assert.ok("error" in checkedIssuer("https://auth.example/app#frag"));
});

test("checkedIssuer strips trailing slashes and keeps port and path", () => {
  assert.deepEqual(checkedIssuer("http://auth.example:9091/app/"), { issuer: "http://auth.example:9091/app" });
});

test("oidcConfig calls checkedIssuer", () => {
  const src = readFileSync(new URL("./oidc.ts", import.meta.url), "utf8");
  assert.match(src, /^\s*const checked = checkedIssuer\(issuer\);/m);
});
