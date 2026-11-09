import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as config from "./config.ts";

// Modules behind the "@/" alias cannot load under node:test, so routes are source-scanned.
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

describe("hunt 25 F1/F4: config.ts under a temp DATA_DIR", () => {
  let dir: string;
  let prev: string | undefined;
  const file = () => join(dir, "hermes", "hermes-settings.json");
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-h25-"));
    process.env.DATA_DIR = dir;
    mkdirSync(join(dir, "hermes"));
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("F1: strict reader returns null for a missing file (start fresh)", () => {
    assert.equal(config.readHermesSettingsFileForSave(), null);
  });
  it("F1: strict reader throws on invalid JSON and on a non-object, and the file is untouched", () => {
    writeFileSync(file(), "{ not json");
    assert.throws(() => config.readHermesSettingsFileForSave(), new RegExp(config.HERMES_SETTINGS_UNREADABLE.slice(0, 20)));
    writeFileSync(file(), "[1]");
    assert.throws(() => config.readHermesSettingsFileForSave());
    assert.equal(readFileSync(file(), "utf8"), "[1]");
  });
  it("F1: the best-effort reader still shows nothing for a bad file", () => {
    writeFileSync(file(), "{ not json");
    assert.equal(config.readHermesSettingsFile(), null);
  });
  it("F1: syncHermesMcpToken throws on a bad file and leaves it byte-identical", () => {
    writeFileSync(file(), "{ not json");
    assert.throws(() => config.syncHermesMcpToken("t".repeat(48)));
    assert.equal(readFileSync(file(), "utf8"), "{ not json");
  });
  it("F1: syncHermesMcpToken on a missing file writes a fresh one; on a good file keeps other tokens", () => {
    config.syncHermesMcpToken("a".repeat(48));
    assert.equal(JSON.parse(readFileSync(file(), "utf8")).nightwatchMcpToken, "a".repeat(48));
    writeFileSync(file(), JSON.stringify({ discordBotToken: "fake-bot", updatedAt: "x" }));
    config.syncHermesMcpToken("b".repeat(48));
    const out = JSON.parse(readFileSync(file(), "utf8"));
    assert.equal(out.discordBotToken, "fake-bot");
    assert.equal(out.nightwatchMcpToken, "b".repeat(48));
  });

  it("F7: an unreadable config.json logs once per mtime; a missing one never logs", () => {
    const logs: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logs.push(a);
    try {
      config.loadConfig();
      assert.equal(logs.length, 0, "missing file is silent");
      const p = join(dir, "config.json");
      writeFileSync(p, "{ broken");
      config.loadConfig();
      config.loadConfig();
      assert.equal(logs.length, 1);
      assert.match(String(logs[0][0]), /config\.json could not be read; using defaults until it is fixed/);
      const later = new Date(Date.now() + 5000);
      writeFileSync(p, "{ still broken");
      utimesSync(p, later, later);
      config.loadConfig();
      assert.equal(logs.length, 2);
    } finally {
      console.error = orig;
    }
  });
});

describe("hunt 25 route scans", () => {
  it("F1: hermes-daemon POST reads with the strict reader and answers 500 without writing", () => {
    const r = src("app/api/settings/hermes-daemon/route.ts");
    assert.match(r, /^\s+existing = readHermesSettingsFileForSave\(\) \?\? \{/m);
    assert.doesNotMatch(r, /readHermesSettingsFile\(\)/);
    assert.match(r, /HERMES_SETTINGS_UNREADABLE[\s\S]{0,80}status: 500/);
  });
  it("F2: the hermes sync has its own try and the response carries hermesSyncFailed", () => {
    const r = src("app/api/settings/system/route.ts");
    assert.match(r, /^\s+try \{\s*\n\s+syncHermesMcpToken\(mcpToken\);/m);
    assert.match(r, /hermesSyncFailed = true/);
    assert.match(r, /^\s+hermesSyncFailed: hermesSyncFailed \|\| undefined,/m);
    const ui = src("components/settings/settings-access.tsx");
    assert.match(ui, /Hermes did not get the new token\. Generate it again, or copy it into Hermes by hand\./);
  });
  it("F3: next.system spreads existing first, and the clear flags are applied before the spread-override keys", () => {
    const r = src("app/api/settings/system/route.ts");
    assert.match(r, /^\s+system: \{\s*\n\s+\.\.\.existing,[^\n]*\n\s+mcpToken,/m);
    // each secret is an explicit key after the spread, so an undefined (cleared) value overrides the old one
    for (const k of ["hermesApiToken", "oidcClientSecret", "kioskPin"]) {
      assert.match(r, new RegExp(`^\\s+${k},$`, "m"));
    }
    // object-spread semantics the route relies on
    const next = { ...{ foo: 1, hermesApiToken: "old" }, hermesApiToken: undefined };
    assert.equal(next.foo, 1);
    assert.equal(JSON.parse(JSON.stringify(next)).hermesApiToken, undefined);
  });
});
