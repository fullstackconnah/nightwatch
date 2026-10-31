import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { saveConfig } from "./config.ts";
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
});
