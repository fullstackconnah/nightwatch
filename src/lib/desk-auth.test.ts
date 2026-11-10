import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deskAccess, isDeskGlancePath } from "./desk-auth.ts";
import { bearerMatches } from "./bearer.ts";
import { systemSetting } from "./config.ts";

const A = "a".repeat(32);
const B = "b".repeat(40);

describe("deskAccess", () => {
  test("on for a 32+ char token that differs from the MCP token", () => {
    assert.equal(deskAccess(A, undefined), "on");
    assert.equal(deskAccess(A, B), "on");
  });
  test("off when missing or empty", () => {
    assert.equal(deskAccess(undefined, B), "off");
    assert.equal(deskAccess("", B), "off");
  });
  test("off under 32 chars, on at exactly 32", () => {
    assert.equal(deskAccess("a".repeat(31), undefined), "off");
    assert.equal(deskAccess("a".repeat(32), undefined), "on");
  });
  test("off when equal to the MCP token", () => assert.equal(deskAccess(A, A), "off"));
});

describe("isDeskGlancePath", () => {
  test("exact path only", () => {
    assert.equal(isDeskGlancePath("/api/desk/glance"), true);
    for (const p of ["/api/desk/glance/x", "/api/desk/glancex", "/api/desk", "/api/deskx", "/API/desk/glance", "/api/desk/glance/"]) {
      assert.equal(isDeskGlancePath(p), false, p);
    }
  });
});

describe("rotation through systemSetting", () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-desk-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  const write = (token: string, secs: number) => {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ system: { deskToken: token } }));
    const t = new Date(Date.now() + secs * 1000);
    utimesSync(p, t, t);
  };
  const check = (header: string) => {
    const tok = systemSetting("deskToken", "DESK_TOKEN");
    return deskAccess(tok, undefined) === "on" && bearerMatches(header, tok);
  };
  test("token A works, then B replaces it without a restart", () => {
    write(A, 10);
    assert.equal(check(`Bearer ${A}`), true);
    write(B, 20);
    assert.equal(check(`Bearer ${A}`), false);
    assert.equal(check(`Bearer ${B}`), true);
  });
});
