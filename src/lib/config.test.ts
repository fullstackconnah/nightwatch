import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fs from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { DATA_DIR_UNWRITABLE, configProblem, saveConfig } from "./config.ts";
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

describe("configProblem", () => {
  let dir: string;
  let prevDataDir: string | undefined;
  beforeEach(() => {
    prevDataDir = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-cfgprob-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (name: string, text: string) => writeFileSync(join(dir, name), text);

  it("is null for a missing file", () => {
    assert.equal(configProblem(), null);
  });
  it("is null for a blank file with no last-good copy", () => {
    put("config.json", "");
    assert.equal(configProblem(), null);
  });
  it("reports a blank file beside a last-good copy", () => {
    put("config.json", "  \n");
    put("config.json.bak", "{}");
    assert.equal(configProblem(), "blank");
  });
  it("reports invalid JSON with and without a copy", () => {
    put("config.json", "{ nope");
    put("config.json.bak", "{}");
    assert.equal(configProblem(), "unreadable");
    rmSync(join(dir, "config.json.bak"));
    assert.equal(configProblem(), "unreadable-no-copy");
  });
  it("reports a non-object file", () => {
    put("config.json", "[]");
    assert.equal(configProblem(), "unreadable-no-copy");
  });
  it("is null for an empty object", () => {
    put("config.json", "{}");
    assert.equal(configProblem(), null);
  });
  it("clears once the file is fixed", () => {
    put("config.json", "{ nope");
    assert.equal(configProblem(), "unreadable-no-copy");
    put("config.json", '{"widgets":[]}');
    assert.equal(configProblem(), null);
  });
  it("config.ts never calls existsSync", () => {
    const src = fs.readFileSync(new URL("./config.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /existsSync\(/);
  });
});
