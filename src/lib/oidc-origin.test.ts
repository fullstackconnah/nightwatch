import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exchangeErrorCode, isSecureRequest, requestOrigin, ssoErrorUrl } from "./oidc-origin.ts";

const req = (proto: string | null, protocol: string) => ({
  headers: { get: (n: string) => (n === "x-forwarded-proto" ? proto : null) },
  nextUrl: { protocol },
});

describe("isSecureRequest", () => {
  it("honours the first x-forwarded-proto value, trimmed and case-folded", () => {
    for (const h of ["https", "https, http", " HTTPS "]) assert.equal(isSecureRequest(req(h, "http:")), true, h);
    for (const h of ["http", "http, https", "", "wss"]) assert.equal(isSecureRequest(req(h, "http:")), false, h);
  });
  it("falls back to the URL protocol when the header is absent", () => {
    assert.equal(isSecureRequest(req(null, "https:")), true);
    assert.equal(isSecureRequest(req(null, "http:")), false);
  });
});

const oreq = (proto: string | null) => ({
  headers: { get: (n: string) => (n === "host" ? "example.test" : n === "x-forwarded-proto" ? proto : null) },
  nextUrl: { host: "0.0.0.0:3005" },
});

describe("requestOrigin with a chained x-forwarded-proto", () => {
  it("takes the first value, trimmed and case-folded", () => {
    assert.equal(requestOrigin(oreq("https,http")), "https://example.test");
    assert.equal(requestOrigin(oreq(" HTTPS , http")), "https://example.test");
  });
  it("falls back to http for an empty or unknown value", () => {
    assert.equal(requestOrigin(oreq("")), "http://example.test");
    assert.equal(requestOrigin(oreq("ftp")), "http://example.test");
  });
  it("ssoErrorUrl does not throw on a chained value", () => {
    assert.equal(ssoErrorUrl(oreq("https,http"), "config").toString(), "https://example.test/login?sso_error=config");
  });
});

describe("exchangeErrorCode", () => {
  it("maps provider outages and config to config", () => {
    for (const code of ["provider_unreachable", "discovery_failed", "config"]) assert.equal(exchangeErrorCode({ code }), "config", code);
  });
  it("maps everything else to exchange_failed", () => {
    for (const e of [{ code: "exchange_failed" }, new Error("x"), null, "provider_unreachable", { code: "verify_failed" }]) {
      assert.equal(exchangeErrorCode(e), "exchange_failed");
    }
  });
});

describe("polish 32 wiring (source text)", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  it("callback maps the exchange error, oidc.ts throws provider_unreachable, the login UI never sees it", () => {
    assert.ok(read("../app/api/auth/oidc/callback/route.ts").includes("ssoErrorRedirect(req, exchangeErrorCode(err))"));
    assert.ok(read("./oidc.ts").includes('new OidcError("provider_unreachable"'));
    for (const f of ["../app/login/page.tsx", "../app/login/login-form.tsx"]) assert.ok(!read(f).includes("provider_unreachable"), f);
  });
});
