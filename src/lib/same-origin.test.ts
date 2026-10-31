import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crossSiteWriteRefused } from "./same-origin.ts";

const h = (o: Record<string, string>) => new Headers(o);
const HOST = { host: "10.0.0.5:3005" };

test("sec-fetch-site decides when present", () => {
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, "sec-fetch-site": "same-site" })), true);
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, "sec-fetch-site": "cross-site" })), true);
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, "sec-fetch-site": "weird" })), true);
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, "sec-fetch-site": "same-origin" })), false);
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, "sec-fetch-site": "none" })), false);
});

test("safe methods are never refused", () => {
  for (const m of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(crossSiteWriteRefused(m, h({ ...HOST, "sec-fetch-site": "cross-site", origin: "http://evil.test" })), false, m);
  }
});

test("other write methods behave like POST", () => {
  for (const m of ["PUT", "PATCH", "DELETE"]) {
    assert.equal(crossSiteWriteRefused(m, h({ ...HOST, "sec-fetch-site": "cross-site" })), true, m);
    assert.equal(crossSiteWriteRefused(m, h({ ...HOST, "sec-fetch-site": "same-origin" })), false, m);
  }
});

test("origin fallback compares host:port", () => {
  // plain-HTTP production: another port on the same IP is refused
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, origin: "http://10.0.0.5:8080" })), true);
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, origin: "http://10.0.0.5:3005" })), false);
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, origin: "null" })), true);
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, origin: "%%garbage" })), true);
  assert.equal(
    crossSiteWriteRefused("POST", h({ host: "internal:3005", "x-forwarded-host": "dash.example.test, other", origin: "https://dash.example.test" })),
    false,
  );
});

test("origin fallback: x-forwarded-host wins over host, first value only", () => {
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, "x-forwarded-host": "evil.test", origin: "http://10.0.0.5:3005" })), true);
  assert.equal(crossSiteWriteRefused("POST", h({ ...HOST, "x-forwarded-host": "10.0.0.5:3005, evil.test", origin: "http://10.0.0.5:3005" })), false);
});

test("no sec-fetch-site or origin: allowed (non-browser client)", () => {
  assert.equal(crossSiteWriteRefused("POST", h(HOST)), false);
});

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// the whole guarded statement, so a dropped return or an ignored result fails
const REFUSE = /if \(.*crossSiteWriteRefused\(req\.method, req\.headers\)\) \{\s*return NextResponse\.json\({ error: "cross-site request refused" }, { status: 403 }\);/;

test("middleware calls the guard before PUBLIC_PATHS and exempts /api/mcp", () => {
  const src = read("../middleware.ts");
  const guard = src.indexOf("crossSiteWriteRefused(");
  const pub = src.indexOf("PUBLIC_PATHS.some");
  assert.ok(guard > 0, "guard not called");
  assert.ok(guard < pub, "guard must run before the PUBLIC_PATHS early return");
  assert.ok(src.includes('pathname !== "/api/mcp" && !pathname.startsWith("/api/mcp/")'), "exact-or-subpath mcp exemption");
  assert.doesNotMatch(src, /startsWith\("\/api\/mcp"\)/, "loose mcp prefix exemption must stay gone");
  assert.match(src, REFUSE);
});

test("upload route calls the guard before uploadAuthorized", () => {
  const src = read("../app/api/minecraft/instances/upload/route.ts");
  const guard = src.indexOf("crossSiteWriteRefused(");
  assert.ok(guard > 0, "guard not called");
  assert.ok(guard < src.indexOf("await uploadAuthorized("), "guard must precede uploadAuthorized");
  assert.match(src, REFUSE);
  assert.match(src, REFUSE);
});
