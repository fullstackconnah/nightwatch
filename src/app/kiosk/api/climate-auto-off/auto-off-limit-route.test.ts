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
const { GET, POST } = await import("./route.ts");
// Same file URL the hook maps "@/lib/climate-auto-off" to, so this is the route's module instance and counter.
const { resetAutoOffSaves } = await import("../../../../lib/climate-auto-off.ts");

const { CONFIG_UNREADABLE } = await import("../../../../lib/config.ts");

const ENV =["DATA_DIR", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
let dir = "";
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-off-limit-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = "test-only-auto-off-limit-secret";
  resetAutoOffSaves();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
  resetAutoOffSaves();
});

function post(patch: unknown) {
  const body = JSON.stringify(patch);
  return POST(new NextRequest("http://localhost/kiosk/api/climate-auto-off", {
    method: "POST",
    body,
    headers: { "content-length": String(Buffer.byteLength(body)) },
  }));
}
// Default is enabled=false, so true first: every call flips the stored value.
const flip = (i: number) => post({ enabled: i % 2 === 0 });

describe("POST /kiosk/api/climate-auto-off save limit", () => {
  it("allows 10 changing saves, then answers 429 with Retry-After and saves nothing", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await flip(i)).status, 200, `save ${i + 1}`);
    const res = await flip(10);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "60");
    assert.deepEqual(await res.json(), { error: "Too many changes. Try again in a minute." });
    // The 10th save (i=9) stored enabled=false; the refused 11th (true) must not have landed.
    assert.equal((await (await GET()).json()).enabled, false);
  });

  it("still answers 200 for a POST that changes nothing once the limit is hit", async () => {
    for (let i = 0; i < 10; i++) await flip(i);
    const res = await post({ enabled: false });
    assert.equal(res.status, 200);
  });

  it("does not spend the limit on POSTs that change nothing", async () => {
    // The first POST creates the stored record (a real save), so store it, then reset the count.
    assert.equal((await post({ enabled: false })).status, 200);
    resetAutoOffSaves();
    for (let i = 0; i < 5; i++) assert.equal((await post({ enabled: false })).status, 200, `no-op ${i + 1}`);
    for (let i = 0; i < 10; i++) assert.equal((await flip(i)).status, 200, `save ${i + 1}`);
  });

  it("does not spend the limit on invalid patches", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await post({ nope: 1 })).status, 400);
    for (let i = 0; i < 10; i++) assert.equal((await flip(i)).status, 200, `save ${i + 1}`);
  });
});

describe("POST /kiosk/api/climate-auto-off unreadable settings", () => {
  it("answers 503 with the unreadable-settings message when config.json is blank but a .bak exists", async () => {
    fs.writeFileSync(path.join(dir, "config.json"), "");
    fs.writeFileSync(path.join(dir, "config.json.bak"), JSON.stringify({ icons: { a: "b" } }));
    const res = await post({ enabled: true });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: CONFIG_UNREADABLE });
  });
});

describe("POST /kiosk/api/climate-auto-off save failure", () => {
  it("answers 500 JSON instead of throwing when the save fails", async () => {
    assert.equal((await post({ enabled: true })).status, 200); // priming save
    // A directory where the atomic writer wants its .tmp file makes saveConfig throw for real.
    const obstruction = path.join(dir, "config.json.tmp");
    fs.mkdirSync(obstruction);
    try {
      const res = await post({ enabled: false });
      assert.equal(res.status, 500);
      const body = await res.json();
      // Not the unwritable-folder kind: no error text, so the tablet keeps its own "Couldn't save" message.
      assert.equal(body.error, undefined);
    } finally {
      fs.rmSync(obstruction, { recursive: true, force: true });
    }
  });
});
