import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

// middleware.ts imports "@/lib/..." and "next/server", which plain node cannot resolve; map them for this process only.
const SRC = new URL("./", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  if (s === "next/server" || s === "next/headers") return next(s + ".js", c);
  return next(s, c);
}`));
const { NextRequest } = await import("next/server");
const { middleware } = await import("./middleware.ts");
const { KIOSK_ELEVATION_COOKIE, SESSION_COOKIE, createKioskElevationToken, createSessionToken, kioskPinTag } = await import("./lib/auth.ts");
const { sessionEpoch } = await import("./lib/config.ts");

const ENV = ["DATA_DIR", "KIOSK_PIN", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
let dir = "";
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "middleware-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = "test-only-middleware-secret";
  process.env.KIOSK_PIN = "123456";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = (pathname: string, cookies: Record<string, string> = {}) =>
  middleware(new NextRequest(`http://localhost${pathname}`, {
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
  }));
// NextResponse.next() marks itself with this header; a redirect or a 401 does not.
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
const KIOSK_API = "/api/docker/containers"; // an API call the elevated kiosk may make (kiosk-access.ts)
const kioskCookie = async (pin: string) => ({ [KIOSK_ELEVATION_COOKIE]: await createKioskElevationToken(sessionEpoch(), await kioskPinTag(pin)) });

describe("middleware auth", () => {
  it("answers 401 JSON to an unauthenticated API call", async () => {
    const res = await call(KIOSK_API);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("redirects an unauthenticated page request to /login", async () => {
    const res = await call("/settings");
    assert.equal(res.status, 307);
    assert.equal(new URL(res.headers.get("location")!).pathname, "/login");
  });

  it("passes a valid session cookie, on a page and on an API call", async () => {
    const cookies = { [SESSION_COOKIE]: await createSessionToken(sessionEpoch()) };
    assert.equal(passes(await call("/settings", cookies)), true);
    assert.equal(passes(await call("/api/settings/system", cookies)), true);
  });

  it("passes a valid kiosk elevation on a kiosk API path only", async () => {
    const cookies = await kioskCookie("123456");
    assert.equal(passes(await call(KIOSK_API, cookies)), true);
    assert.equal((await call("/api/settings/system", cookies)).status, 401);
    assert.equal((await call("/settings", cookies)).status, 307);
  });

  it("refuses an elevation whose PIN tag no longer matches", async () => {
    const cookies = await kioskCookie("123456");
    process.env.KIOSK_PIN = "654321";
    assert.equal((await call(KIOSK_API, cookies)).status, 401);
  });

  it("refuses an elevation once no PIN is configured", async () => {
    const cookies = await kioskCookie("123456");
    delete process.env.KIOSK_PIN;
    assert.equal((await call(KIOSK_API, cookies)).status, 401);
  });

  it("lets a public path through with no cookie", async () => {
    assert.equal(passes(await call("/login")), true);
  });
});
