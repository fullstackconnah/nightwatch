import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as config from "./config.ts";
import { secretKey, isMissingSecretError } from "./auth.ts";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const env = process.env as Record<string, string | undefined>;

describe("hunt 32 F2: no session signing with the password hash", () => {
  const keys = ["SESSION_SECRET", "ADMIN_PASSWORD_HASH", "NODE_ENV"];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => keys.forEach((k) => (saved[k] = env[k])));
  afterEach(() => keys.forEach((k) => (saved[k] === undefined ? delete env[k] : (env[k] = saved[k]))));

  it("production with only ADMIN_PASSWORD_HASH throws a missing-secret error", () => {
    env.NODE_ENV = "production";
    delete env.SESSION_SECRET;
    env.ADMIN_PASSWORD_HASH = "fake-hash-not-real";
    assert.throws(() => secretKey(), (e) => isMissingSecretError(e) && !String(e).includes("ADMIN_PASSWORD_HASH"));
  });
  it("outside production the hash is not used either (dev literal)", () => {
    env.NODE_ENV = "development";
    delete env.SESSION_SECRET;
    env.ADMIN_PASSWORD_HASH = "fake-hash-not-real";
    assert.equal(new TextDecoder().decode(secretKey()), "homelab-dashboard-dev-secret");
  });
  it("the 503 text tells the installer what to set", () => {
    for (const f of ["app/api/auth/login/route.ts", "app/api/auth/kiosk/route.ts"]) {
      assert.match(src(f), /Set SESSION_SECRET in \.env \(a long random string\), then restart\./, f);
    }
  });
});

describe("hunt 32 F4/F5/F1: config.ts under a temp DATA_DIR", () => {
  let dir: string;
  let prev: string | undefined;
  const file = () => join(dir, "config.json");
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-h32-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("F4: an empty or whitespace-only config.json is a fresh install (saves allowed)", () => {
    for (const body of ["", "  \n\t "]) {
      writeFileSync(file(), body);
      assert.deepEqual(config.loadConfigForSave().widgets, []);
      assert.deepEqual(config.loadConfig().groups, []);
    }
  });
  it("F4: a non-empty file that does not parse still refuses saves", () => {
    writeFileSync(file(), "{ not json");
    assert.throws(() => config.loadConfigForSave(), new RegExp(config.CONFIG_UNREADABLE.slice(0, 20)));
  });
  it("F4: an empty hermes-settings.json agrees (start fresh); a broken one still throws", () => {
    mkdirSync(join(dir, "hermes"));
    const hf = join(dir, "hermes", "hermes-settings.json");
    writeFileSync(hf, " \n");
    assert.equal(config.readHermesSettingsFileForSave(), null);
    writeFileSync(hf, "{ nope");
    assert.throws(() => config.readHermesSettingsFileForSave());
  });
  it("F5: a null core section keeps the default", () => {
    writeFileSync(file(), JSON.stringify({ widgets: null, groups: null, hidden: null, urls: null, icons: null }));
    const c = config.loadConfig();
    assert.deepEqual(c.widgets, []);
    assert.deepEqual(c.groups, []);
    assert.deepEqual(c.hidden, []);
    assert.deepEqual(c.urls, {});
    assert.deepEqual(c.icons, {});
  });
  it("F1: EACCES and EPERM map to the data-folder message; others pass through", () => {
    for (const code of ["EACCES", "EPERM"]) {
      const m = config.mapWriteError(Object.assign(new Error("denied"), { code }));
      assert.equal((m as Error).message, config.DATA_DIR_UNWRITABLE);
    }
    const other = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    assert.equal(config.mapWriteError(other), other);
  });
  it("F1: the save routes pass the message through, else 'save failed'", () => {
    assert.equal(config.saveErrorText(new Error(config.DATA_DIR_UNWRITABLE)), config.DATA_DIR_UNWRITABLE);
    assert.equal(config.saveErrorText(new Error("x")), "save failed");
    for (const f of ["app/api/settings/system/route.ts", "app/api/settings/integrations/route.ts"]) {
      assert.match(src(f), /\{ error: saveErrorText\(e\) \}/, f);
    }
  });
});
