import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadConfig, loadConfigForSave } from "./config.ts";
import { mergeDashPut } from "./settings/dash-put.ts";
import type { AppConfig } from "./config.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("hunt 8 A1: loadConfigForSave", () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-h8-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("a missing file gives the defaults (first run)", () => {
    assert.deepEqual(loadConfigForSave().widgets, []);
  });
  it("a valid file is parsed", () => {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ hidden: ["abc"] }));
    assert.deepEqual(loadConfigForSave().hidden, ["abc"]);
  });
  it("corrupt JSON throws the fixed message and leaves the file alone", () => {
    const bad = '{ "hidden": ["abc"] "urls": {} }';
    writeFileSync(join(dir, "config.json"), bad);
    assert.throws(() => loadConfigForSave(), /Couldn't read the saved settings, so nothing was saved\. Check data\/config\.json\./);
    assert.equal(readFileSync(join(dir, "config.json"), "utf8"), bad);
    assert.deepEqual(readdirSync(dir), ["config.json"]);
  });
  it("a non-object file read tolerantly first is not cached: the strict read still throws", () => {
    writeFileSync(join(dir, "config.json"), "null");
    assert.deepEqual(loadConfig().widgets, []);
    assert.throws(() => loadConfigForSave(), /nothing was saved/);
  });
  it("a read error other than ENOENT throws", () => {
    // a directory where the file should be: statSync works, readFileSync fails with EISDIR
    mkdirSync(join(dir, "config.json"));
    assert.throws(() => loadConfigForSave(), /nothing was saved/);
  });
});

describe("hunt 8 A1: every save path reads strictly", () => {
  // The count is pinned so a new save route is added here on purpose, with its strict read.
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) files.push(p);
    }
  };
  walk(fileURLToPath(new URL("../app", import.meta.url)));
  const calls = (src: string) => src.split("\n").some((l) => /\bsaveConfig\(/.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l));
  const savers = files.filter((f) => calls(readFileSync(f, "utf8")));
  it("there are exactly 7 routes that call saveConfig", () => {
    assert.equal(savers.length, 7, savers.join("\n"));
  });
  for (const f of savers) {
    it(`${f.split(/[\\/]app[\\/]/).pop()} loads with loadConfigForSave`, () => {
      const src = readFileSync(f, "utf8");
      assert.ok(src.includes("loadConfigForSave()"));
      assert.ok(src.includes("status: 500"));
    });
  }
});

describe("hunt 8 A2: non-object widgets and groups", () => {
  const cur = { widgets: [], groups: [] } as unknown as AppConfig;
  for (const field of ["widgets", "groups"] as const) {
    for (const bad of [[null], [1], ["x"], [[]]]) {
      it(`${field} ${JSON.stringify(bad)} is refused`, () => {
        const r = mergeDashPut(cur, { [field]: bad });
        assert.deepEqual(r, { error: field === "widgets" ? "Each widget must be an object" : "Each group must be an object" });
      });
    }
  }
  it("a valid widget list merges", () => {
    assert.ok("next" in mergeDashPut(cur, { widgets: [{ id: "a", type: "clock" }] }));
  });
});

describe("hunt 8 A3: fsync before rename", () => {
  it("writeJsonAtomic syncs the temp file before the rename", () => {
    const src = read("./config.ts");
    const fn = src.slice(src.indexOf("function writeJsonAtomic"));
    assert.ok(fn.indexOf("fsyncSync") > -1 && fn.indexOf("fsyncSync") < fn.indexOf("renameSync"));
  });
});
