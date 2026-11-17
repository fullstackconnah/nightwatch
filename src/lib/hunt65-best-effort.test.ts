import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readHermesModelFile, readHermesSettingsFile } from "./config.ts";

describe("hunt 65 F4: readJsonBestEffort rejects arrays", () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "h65-best-effort-"));
    process.env.DATA_DIR = dir;
    mkdirSync(join(dir, "hermes"));
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("a [] hermes file reads like a missing one", () => {
    const missing = [readHermesModelFile(), readHermesSettingsFile()];
    writeFileSync(join(dir, "hermes", "hermes-model.json"), "[]");
    writeFileSync(join(dir, "hermes", "hermes-settings.json"), "[1,2]");
    assert.deepEqual([readHermesModelFile(), readHermesSettingsFile()], missing);
    assert.deepEqual(missing, [null, null]);
  });
  it("an object still reads", () => {
    writeFileSync(join(dir, "hermes", "hermes-model.json"), '{"tier":"local","model":"m","updatedAt":"x"}');
    assert.equal(readHermesModelFile()?.model, "m");
  });
});
