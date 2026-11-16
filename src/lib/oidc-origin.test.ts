import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSecureRequest } from "./oidc-origin.ts";

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
