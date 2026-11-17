import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

// The route imports "@/lib/..." and "next/server", which plain node cannot resolve; map them for this process only.
const SRC = new URL("../../../../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  if (s === "next/server" || s === "next/headers") return next(s + ".js", c);
  return next(s, c);
}`));
const { NextRequest } = await import("next/server");
const { POST } = await import("./route.ts");
const { KIOSK_ELEVATION_COOKIE, kioskPinTag, verifyKioskElevationToken } = await import("../../../../lib/auth.ts");
const { kioskPin, sessionEpoch } = await import("../../../../lib/config.ts");

const ENV = ["DATA_DIR", "KIOSK_PIN", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
let dir = "";
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-unlock-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = "test-only-unlock-route-secret";
  process.env.KIOSK_PIN = "123456";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

const unlock = (pin: unknown) =>
  POST(new NextRequest("http://localhost/api/auth/kiosk", { method: "POST", body: JSON.stringify({ pin }) }));

describe("POST /api/auth/kiosk", () => {
  it("accepts the right PIN and sets an elevation cookie bound to that PIN", async () => {
    const res = await unlock("123456");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.expiresAt > Date.now());
    const cookie = res.cookies.get(KIOSK_ELEVATION_COOKIE);
    assert.ok(cookie?.value);
    assert.equal(await verifyKioskElevationToken(cookie.value, sessionEpoch(), await kioskPinTag(kioskPin())), true);
  });

  it("refuses a wrong PIN with 401 and sets no cookie", async () => {
    const res = await unlock("000000");
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "Incorrect PIN");
    assert.equal(res.cookies.get(KIOSK_ELEVATION_COOKIE), undefined);
  });

  it("refuses a missing or non-string PIN", async () => {
    for (const pin of [undefined, "", 123456]) {
      const res = await unlock(pin);
      assert.equal(res.status, 401);
      assert.equal(res.cookies.get(KIOSK_ELEVATION_COOKIE), undefined);
    }
  });

  it("an unlock token stops verifying once the PIN changes", async () => {
    const res = await unlock("123456");
    const token = res.cookies.get(KIOSK_ELEVATION_COOKIE)!.value;
    process.env.KIOSK_PIN = "654321";
    assert.equal(await verifyKioskElevationToken(token, sessionEpoch(), await kioskPinTag(kioskPin())), false);
  });

  it("answers 503 and sets no cookie when no PIN is configured", async () => {
    delete process.env.KIOSK_PIN;
    const res = await unlock("123456");
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /PIN not configured/);
    assert.equal(res.cookies.get(KIOSK_ELEVATION_COOKIE), undefined);
  });
});
