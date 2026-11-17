import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

// The routes import "@/lib/..." and "next/server", which plain node cannot resolve; map them for this process only.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  if (s === "next/server" || s === "next/headers") return next(s + ".js", c);
  return next(s, c);
}`));
const { NextRequest } = await import("next/server");

const KB = 1024;
// The cap check is the first statement of each handler, ahead of auth and of any body parse.
const ROUTES: { name: string; cap: number; load: () => Promise<{ POST: (req: InstanceType<typeof NextRequest>) => Promise<Response> }>; url: string }[] = [
  { name: "settings/hermes-daemon", cap: 64 * KB, url: "/api/settings/hermes-daemon", load: () => import("../app/api/settings/hermes-daemon/route.ts") },
  { name: "settings/integrations", cap: 256 * KB, url: "/api/settings/integrations", load: () => import("../app/api/settings/integrations/route.ts") },
  { name: "settings/password", cap: 64 * KB, url: "/api/settings/password", load: () => import("../app/api/settings/password/route.ts") },
  { name: "settings/system", cap: 64 * KB, url: "/api/settings/system", load: () => import("../app/api/settings/system/route.ts") },
  { name: "kiosk/api/assistant", cap: 4 * KB, url: "/kiosk/api/assistant", load: () => import("../app/kiosk/api/assistant/route.ts") },
  { name: "kiosk/api/climate-auto-off", cap: 64 * KB, url: "/kiosk/api/climate-auto-off", load: () => import("../app/kiosk/api/climate-auto-off/route.ts") },
  { name: "kiosk/api/ha/action", cap: 64 * KB, url: "/kiosk/api/ha/action", load: () => import("../app/kiosk/api/ha/action/route.ts") },
];

const ENV = ["DATA_DIR", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
let dir = "";
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "body-cap-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = "test-only-body-cap-secret";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// A body that is not JSON: a handler that parsed it before the cap check would answer 400, not 411/413.
const NOT_JSON = "{not json";

for (const r of ROUTES) {
  describe(`POST ${r.name} body cap`, () => {
    it("answers 411 when Content-Length is missing", async () => {
      const { POST } = await r.load();
      const res = await POST(new NextRequest(`http://localhost${r.url}`, { method: "POST", body: NOT_JSON }));
      assert.equal(res.status, 411);
    });

    it(`answers 413 for a Content-Length one byte over ${r.cap / KB} KB, without parsing the body`, async () => {
      const { POST } = await r.load();
      const res = await POST(new NextRequest(`http://localhost${r.url}`, {
        method: "POST",
        body: NOT_JSON,
        headers: { "content-length": String(r.cap + 1) },
      }));
      assert.equal(res.status, 413);
    });

    // Every handler refuses a non-JSON body (400, or 401 for auth) before it saves or sends anything.
    it(`lets a Content-Length of exactly ${r.cap / KB} KB through the cap (the boundary is > not >=)`, async () => {
      const { POST } = await r.load();
      const res = await POST(new NextRequest(`http://localhost${r.url}`, {
        method: "POST",
        body: NOT_JSON,
        headers: { "content-length": String(r.cap) },
      }));
      assert.notEqual(res.status, 411);
      assert.notEqual(res.status, 413);
      assert.ok([400, 401].includes(res.status), `status ${res.status}`);
    });
  });
}
