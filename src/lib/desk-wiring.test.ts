import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicSystem } from "./orchestra-settings.ts";

// The route and middleware need @/ aliases and next/server, so they are pinned as source (precedent: middleware-matcher.test.ts).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("../app/api/desk/glance/route.ts");
const mw = read("../middleware.ts");

test("route exports only GET and dynamic", () => {
  const exported = [...route.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "dynamic"]);
  assert.match(route, /^export const dynamic = "force-dynamic";/m);
});

test("every response path is no-store", () => {
  assert.match(route, /^const NO_STORE = \{ "Cache-Control": "no-store" \};/m);
  const responses = [...route.matchAll(/NextResponse\.json\(/g)].length;
  const withHeader = [...route.matchAll(/NextResponse\.json\([^;]*headers: NO_STORE/g)].length;
  assert.equal(responses, 3);
  assert.equal(withHeader, responses);
});

test("route reads both settings per request and checks deskAccess before bearerMatches", () => {
  assert.match(route, /^\s+const deskToken = systemSetting\("deskToken", "DESK_TOKEN"\);/m);
  assert.match(route, /^\s+const mcpToken = systemSetting\("mcpToken", "MCP_TOKEN"\);/m);
  assert.doesNotMatch(route, /^const \w+ = systemSetting/m);
  assert.ok(route.indexOf("deskAccess(") < route.indexOf("bearerMatches("));
  assert.match(route, /Desk access is not turned on\./);
  assert.match(route, /buildGlance\(/);
});

test("route falls back to null vitals on failure", () => {
  assert.match(route, /try \{[^}]*kioskVitals\(await getHostVitals\(\)\)[^}]*\} catch/);
});

test("middleware: exact path check before the cross-site and public-path checks, not in PUBLIC_PATHS", () => {
  assert.match(mw, /^\s+if \(isDeskGlancePath\(pathname\)\) return NextResponse\.next\(\);/m);
  assert.ok(mw.indexOf("isDeskGlancePath(pathname)") < mw.indexOf("crossSiteWriteRefused(req.method"));
  const list = /const PUBLIC_PATHS = \[([^\]]*)\]/.exec(mw)?.[1] ?? "";
  assert.doesNotMatch(list, /desk/);
});

test("publicSystem drops deskToken", () => {
  const out = publicSystem({ deskToken: "x".repeat(40), hermesApiUrl: "http://h" });
  assert.equal(JSON.stringify(out).includes("deskToken"), false);
  assert.equal(out?.hermesApiUrl, "http://h");
});

test("settings/system POST keeps an unknown existing field (so deskToken) and never names it", () => {
  const r = read("../app/api/settings/system/route.ts");
  assert.match(r, /^\s+\.\.\.existing,/m);
  assert.doesNotMatch(r, /deskToken/);
});

test("no console. in the new files, the middleware or mcp auth", () => {
  for (const p of ["./bearer.ts", "./desk-auth.ts", "./desk-glance.ts", "../app/api/desk/glance/route.ts", "../middleware.ts", "./mcp/auth.ts"]) {
    assert.doesNotMatch(read(p), /console\./, p);
  }
});

test("mcp auth delegates to bearerMatches", () => {
  const a = read("./mcp/auth.ts");
  assert.match(a, /^import \{ bearerMatches \} from "@\/lib\/bearer";/m);
  assert.doesNotMatch(a, /timingSafeEqual/);
});
