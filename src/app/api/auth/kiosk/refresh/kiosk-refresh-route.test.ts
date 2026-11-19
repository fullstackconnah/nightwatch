import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

// The route imports "@/lib/..." and "next/server", which plain node cannot resolve; map them for this process only.
const SRC = new URL("../../../../../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  if (s === "next/server" || s === "next/headers") return next(s + ".js", c);
  return next(s, c);
}`));
const { NextRequest } = await import("next/server");
const { POST } = await import("./route.ts");
const { KIOSK_ELEVATION_COOKIE, createKioskElevationToken, kioskPinTag, verifyKioskElevationToken } = await import("../../../../../lib/auth.ts");
const { sessionEpoch } = await import("../../../../../lib/config.ts");

const ENV = ["DATA_DIR", "KIOSK_PIN", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
let dir = "";
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-refresh-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = "test-only-refresh-route-secret";
  process.env.KIOSK_PIN = "123456";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

const refresh = (token?: string) =>
  POST(new NextRequest("http://localhost/api/auth/kiosk/refresh", {
    method: "POST",
    headers: token ? { cookie: `${KIOSK_ELEVATION_COOKIE}=${token}` } : {},
  }));

// A clearing Set-Cookie: empty value, Max-Age=0, same Path as the one that set it (a different Path would not clear it).
function assertCleared(res: Response) {
  const header = res.headers.get("set-cookie") ?? "";
  assert.match(header, new RegExp(`^${KIOSK_ELEVATION_COOKIE}=;`));
  assert.match(header, /Max-Age=0/i);
  assert.match(header, /Path=\//);
}

describe("POST /api/auth/kiosk/refresh", () => {
  it("renews a live elevation and mints a fresh token for the same PIN", async () => {
    const tag = await kioskPinTag("123456");
    const res = await refresh(await createKioskElevationToken(sessionEpoch(), tag));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.elevated, true);
    assert.ok(body.expiresAt > Date.now());
    const fresh = res.cookies.get(KIOSK_ELEVATION_COOKIE);
    assert.ok(fresh?.value);
    assert.equal(await verifyKioskElevationToken(fresh.value, sessionEpoch(), tag), true);
  });

  it("answers elevated:false with no cookie change when there is no cookie", async () => {
    const res = await refresh();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { elevated: false });
    assert.equal(res.cookies.get(KIOSK_ELEVATION_COOKIE), undefined);
    assert.equal(res.headers.get("set-cookie"), null); // an ambient kiosk gets no cookie write per poll
  });

  it("refuses a token minted under another PIN and clears it instead of minting", async () => {
    const res = await refresh(await createKioskElevationToken(sessionEpoch(), await kioskPinTag("999999")));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { elevated: false });
    assertCleared(res);
  });

  it("locks an unlocked kiosk once the PIN changes and clears the dead cookie", async () => {
    const token = await createKioskElevationToken(sessionEpoch(), await kioskPinTag("123456"));
    process.env.KIOSK_PIN = "654321";
    const res = await refresh(token);
    assert.deepEqual(await res.json(), { elevated: false });
    assertCleared(res);
  });

  it("clears a garbage cookie the same way", async () => {
    const res = await refresh("not-a-token");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { elevated: false });
    assertCleared(res);
  });

  it("clears the cookie when no PIN is configured", async () => {
    const token = await createKioskElevationToken(sessionEpoch(), await kioskPinTag("123456"));
    delete process.env.KIOSK_PIN;
    const res = await refresh(token);
    assert.deepEqual(await res.json(), { elevated: false });
    const cleared = res.cookies.get(KIOSK_ELEVATION_COOKIE);
    assert.equal(cleared?.value, "");
    assert.equal(cleared?.maxAge, 0);
  });
});
