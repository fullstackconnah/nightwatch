import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isKioskRadarProduct, isPngBytes } from "./radar-frame.ts";
import { requestOrigin, ssoErrorUrl } from "./oidc-origin.ts";
import { cancelResponse, enqueueResponse } from "./media/routes.ts";
import type { MediaWorkerClient } from "./media/worker.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("hunt 9 A3: radar frame product", () => {
  const loop = { product: "IDR023", site: "x", place: "y", frames: [] };
  it("accepts only the kiosk's own product", () => {
    assert.equal(isKioskRadarProduct("IDR023", loop), true);
    assert.equal(isKioskRadarProduct("IDR024", loop), false);
  });
  it("accepts nothing when the kiosk has no radar configured", () => {
    assert.equal(isKioskRadarProduct("IDR023", null), false);
  });
});

describe("hunt 9 A2: PNG signature", () => {
  it("accepts a PNG and rejects other bytes", () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    assert.equal(isPngBytes(new Uint8Array([...sig, 1, 2]).buffer), true);
    assert.equal(isPngBytes(new TextEncoder().encode("<html>nope</html>").buffer as ArrayBuffer), false);
    assert.equal(isPngBytes(new Uint8Array(sig.slice(0, 4)).buffer), false);
  });
});

describe("hunt 9 A4: SSO error redirect origin", () => {
  const req = (host: string, proto?: string) => ({
    headers: new Headers({ host, ...(proto ? { "x-forwarded-proto": proto } : {}) }),
    nextUrl: { host: "0.0.0.0:3005" },
  });
  it("uses the browser's Host, not the bind address", () => {
    assert.equal(requestOrigin(req("example.test:3005")), "http://example.test:3005");
    assert.equal(requestOrigin(req("example.test", "https")), "https://example.test");
  });
  it("ssoErrorUrl is /login?sso_error=<code> on that origin", () => {
    assert.equal(ssoErrorUrl(req("example.test:3005"), "denied").toString(), "http://example.test:3005/login?sso_error=denied");
  });
  it("both routes use the shared helper, not nextUrl.clone()", () => {
    for (const f of ["../app/api/auth/oidc/callback/route.ts", "../app/api/auth/oidc/login/route.ts"]) {
      const src = read(f);
      assert.ok(src.includes("ssoErrorUrl("), f);
      assert.ok(!src.includes("nextUrl.clone()"), f);
    }
  });
});

describe("hunt 9 A1: kiosk health 502 text", () => {
  it("goes through throwingSnapshotRoute (fixed text), never e.message", () => {
    const src = read("../app/kiosk/api/health/route.ts");
    assert.ok(src.includes("throwingSnapshotRoute"));
    assert.ok(!src.includes("e.message"));
  });
});

const stub = (over: Partial<MediaWorkerClient>) => over as MediaWorkerClient;
const fail409 = { status: "error", detail: "HTTP 409: boom", httpStatus: 409 };

describe("hunt 9 A5: media path caps", () => {
  const never = stub({ enqueue: async () => { throw new Error("must not reach the worker"); } });
  const long = "a".repeat(4097);
  it("path over 4096 characters is a 400", async () => {
    assert.equal((await enqueueResponse({ path: long }, never)).status, 400);
  });
  it("any entry of paths over 4096 characters is a 400", async () => {
    assert.equal((await enqueueResponse({ paths: ["ok", long] }, never)).status, 400);
  });
  it("exactly 4096 passes", async () => {
    const ok = stub({ enqueue: async () => ({ status: "ok", data: {} }) as never });
    assert.equal((await enqueueResponse({ path: "a".repeat(4096) }, ok)).status, 201);
  });
});

describe("hunt 9 A6: 409 wording", () => {
  it("cancel's fallback is the job sentence", async () => {
    const r = await cancelResponse("abcdefgh-1", stub({ cancel: async () => fail409 as never }));
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as { error: string }).error, "That job can't be changed right now.");
  });
  it("compress keeps its own text", async () => {
    const r = await enqueueResponse({ path: "a" }, stub({ enqueue: async () => fail409 as never }));
    assert.equal(((await r.json()) as { error: string }).error, "it can't be compressed right now");
  });
});
