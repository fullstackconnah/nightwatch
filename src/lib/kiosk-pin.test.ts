import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { kioskPinConfigured, loadConfig, saveConfig } from "./config.ts";

describe("kioskPinConfigured: the one resolution the unlock route uses", () => {
  let dir = "";
  let prevDir: string | undefined;
  let prevPin: string | undefined;
  let n = 0;
  beforeEach(() => {
    prevDir = process.env.DATA_DIR;
    prevPin = process.env.KIOSK_PIN;
    delete process.env.KIOSK_PIN;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-kpin-"));
    process.env.DATA_DIR = dir;
    saveConfig(loadConfig()); // resets the loadConfig cache for this dir
  });
  afterEach(() => {
    if (prevDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDir;
    if (prevPin === undefined) delete process.env.KIOSK_PIN;
    else process.env.KIOSK_PIN = prevPin;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const writeRaw = (system: unknown) => {
    const f = path.join(dir, "config.json");
    fs.writeFileSync(f, JSON.stringify({ system }));
    const t = new Date(Date.now() + 10_000 * ++n); // a unique mtime so the cache cannot serve another case's file
    fs.utimesSync(f, t, t);
  };
  it("is false with neither a saved nor an environment PIN", () => assert.equal(kioskPinConfigured(), false));
  it("is true with a saved PIN", () => {
    writeRaw({ kioskPin: "123456" });
    assert.equal(kioskPinConfigured(), true);
  });
  it("is true with only KIOSK_PIN in the environment", () => {
    process.env.KIOSK_PIN = "654321";
    assert.equal(kioskPinConfigured(), true);
  });
  it("treats a whitespace-only saved PIN as unset, as the unlock route does", () => {
    writeRaw({ kioskPin: "   " });
    assert.equal(kioskPinConfigured(), false);
  });
});

describe("every elevation-cookie check goes through kioskPinConfigured", () => {
  const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
  it("the refresh route", () => assert.match(read("app/api/auth/kiosk/refresh/route.ts"), /kioskPinConfigured\(\)/));
  it("the middleware", () => assert.match(read("middleware.ts"), /kioskPinConfigured\(\)/));
  it("the kiosk list store", () => assert.match(read("lib/kiosk-list-store.ts"), /kioskPinConfigured\(\)/));
});
