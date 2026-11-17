import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fs from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { CONFIG_UNREADABLE, DATA_DIR_UNWRITABLE, loadConfig, loadConfigForSave, saveConfig } from "./config.ts";
import type { AppConfig } from "./config.ts";

// Windows ignores POSIX mode bits, so the mode assertions only run on Linux (CI).
const skipOnWindows = process.platform === "win32";

describe("saveConfig file mode", () => {
  let dir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    prevDataDir = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-config-"));
    process.env.DATA_DIR = dir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  const modeOf = (name: string) => statSync(join(dir, name)).mode & 0o777;
  const config = {} as AppConfig;

  it("writes config.json owner-only", { skip: skipOnWindows }, () => {
    saveConfig(config);
    assert.equal(modeOf("config.json"), 0o600);
  });

  it("a leftover 0644 config.json.tmp still ends owner-only", { skip: skipOnWindows }, () => {
    const tmp = join(dir, "config.json.tmp");
    writeFileSync(tmp, "stale");
    chmodSync(tmp, 0o644);
    saveConfig(config);
    assert.equal(modeOf("config.json"), 0o600);
  });

  it("an existing 0644 config.json ends owner-only after a save", { skip: skipOnWindows }, () => {
    const file = join(dir, "config.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o644);
    saveConfig(config);
    assert.equal(modeOf("config.json"), 0o600);
  });

  // Stubbing the fs call keeps this portable: a real root-owned dir can't be made on Windows or in CI.
  it("saveConfig turns an EACCES write failure into the data-folder error", () => {
    const stub = mock.method(fs, "mkdirSync", () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    try {
      assert.throws(() => saveConfig(config), { message: DATA_DIR_UNWRITABLE });
    } finally {
      stub.mock.restore();
    }
  });
});

describe("an empty config.json", () => {
  let dir: string;
  let prevDataDir: string | undefined;
  beforeEach(() => {
    prevDataDir = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-config-empty-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("is refused by the strict read but reads as defaults on the lenient one", () => {
    for (const body of ["", "  \n"]) {
      writeFileSync(join(dir, "config.json"), body);
      assert.throws(() => loadConfigForSave(), { message: CONFIG_UNREADABLE });
      assert.deepEqual(loadConfig().groups, []);
    }
  });

  it("a missing file reads as defaults on both", () => {
    assert.deepEqual(loadConfigForSave().groups, []);
    assert.deepEqual(loadConfig().groups, []);
  });
});
