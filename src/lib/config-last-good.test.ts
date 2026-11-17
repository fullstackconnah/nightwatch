import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as config from "./config.ts";

describe("hunt 64: config.json.bak last-good copy", () => {
  let dir: string;
  let prev: string | undefined;
  const file = () => join(dir, "config.json");
  const bak = () => join(dir, "config.json.bak");
  const withIcon = (v: string) => ({ ...config.loadConfig(), icons: { marker: v } });
  /** Change the mtime so the in-process cache cannot mask a same-millisecond rewrite. */
  const bump = () => utimesSync(file(), new Date(), new Date(Date.now() + 5000));
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-h64-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("saving over a valid file leaves .bak byte-equal to the previous config.json", () => {
    config.saveConfig(withIcon("one"));
    const before = readFileSync(file(), "utf8");
    config.saveConfig(withIcon("two"));
    assert.equal(readFileSync(bak(), "utf8"), before);
    assert.match(readFileSync(file(), "utf8"), /two/);
  });
  it("two saves: .bak holds the content from before the second save", () => {
    config.saveConfig(withIcon("one"));
    config.saveConfig(withIcon("two"));
    const second = readFileSync(file(), "utf8");
    config.saveConfig(withIcon("three"));
    assert.equal(readFileSync(bak(), "utf8"), second);
  });
  it("the first ever save makes no .bak", () => {
    config.saveConfig(withIcon("one"));
    assert.equal(existsSync(bak()), false);
  });
  it("a blanked config.json with a .bak is damage: strict throws, non-strict gets defaults, .bak keeps the setting", () => {
    config.saveConfig(withIcon("recognisable"));
    config.saveConfig(withIcon("recognisable"));
    truncateSync(file(), 0);
    bump();
    assert.throws(() => config.loadConfigForSave(), (e) => e instanceof Error && e.message === config.CONFIG_UNREADABLE);
    assert.deepEqual(config.loadConfig().icons, {});
    assert.match(readFileSync(bak(), "utf8"), /recognisable/);
    assert.equal(statSync(file()).size, 0);
  });
  it("a blanked config.json with a .bak logs once, not on every read", () => {
    config.saveConfig(withIcon("one"));
    config.saveConfig(withIcon("two"));
    truncateSync(file(), 0);
    utimesSync(file(), new Date(), new Date(Date.now() + 987654)); // a unique mtime, so an earlier test's logged version cannot hide the line
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      for (let i = 0; i < 5; i++) config.loadConfig();
    } finally {
      console.error = orig;
    }
    assert.equal(lines.length, 1, lines.join(" | "));
    assert.match(lines[0], /config.json.bak/);
  });
  it("a blank file with no .bak is a fresh install: strict read returns defaults and a save works", () => {
    writeFileSync(file(), "");
    assert.deepEqual(config.loadConfigForSave().widgets, []);
    config.saveConfig(withIcon("fresh"));
    assert.match(readFileSync(file(), "utf8"), /fresh/);
  });
  it("a blank or unparsable current file never overwrites an existing .bak", () => {
    config.saveConfig(withIcon("one"));
    config.saveConfig(withIcon("two"));
    const good = readFileSync(bak(), "utf8");
    for (const body of ["", "  \n", "{not json", "null", "[1]"]) {
      writeFileSync(file(), body);
      config.saveConfig(withIcon("x")); // a non-strict caller can still save
      assert.equal(readFileSync(bak(), "utf8"), good, JSON.stringify(body));
    }
  });
  it("the .bak is mode 0600", { skip: process.platform === "win32" }, () => {
    config.saveConfig(withIcon("one"));
    config.saveConfig(withIcon("two"));
    assert.equal(statSync(bak()).mode & 0o777, 0o600);
  });
});
