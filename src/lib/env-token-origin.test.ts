import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { saveConfig, secretForSettingUrl, systemSetting } from "./config.ts";
import type { AppConfig } from "./config.ts";
import { orchestraCredentials, orchestraTokenSet } from "./orchestra.ts";

const ENV_KEYS = ["ORCHESTRA_URL", "ORCHESTRA_TOKEN", "HERMES_API_URL", "HERMES_API_TOKEN", "DATA_DIR"];
const saved: Record<string, string | undefined> = {};
let dir: string;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  dir = mkdtempSync(join(tmpdir(), "nw-envtok-"));
  process.env.DATA_DIR = dir;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

const save = (system: Record<string, string>) => saveConfig({ system } as unknown as AppConfig);

const cases = [
  { name: "orchestra", read: orchestraCredentials, urlEnv: "ORCHESTRA_URL", tokEnv: "ORCHESTRA_TOKEN", urlKey: "orchestraUrl", tokKey: "orchestraToken" },
  { name: "hermes", read: () => {
      const token = secretForSettingUrl("hermesApiUrl", "HERMES_API_URL", "hermesApiToken", "HERMES_API_TOKEN");
      const url = systemSetting("hermesApiUrl", "HERMES_API_URL");
      return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
    }, urlEnv: "HERMES_API_URL", tokEnv: "HERMES_API_TOKEN", urlKey: "hermesApiUrl", tokKey: "hermesApiToken" },
];

for (const c of cases) {
  describe(`${c.name} credentials: an env token goes only to the env URL's origin`, () => {
    it("env URL + env token: returned", () => {
      process.env[c.urlEnv] = "http://10.0.0.5:8001";
      process.env[c.tokEnv] = "env-tok";
      assert.deepEqual(c.read(), { url: "http://10.0.0.5:8001", token: "env-tok" });
    });

    it("saved URL on another host + env token: not connected", () => {
      process.env[c.urlEnv] = "http://10.0.0.5:8001";
      process.env[c.tokEnv] = "env-tok";
      save({ [c.urlKey]: "http://10.9.9.9:8001" });
      assert.equal(c.read(), null);
    });

    it("saved URL on the same origin (other path, trailing slash) + env token: returned", () => {
      process.env[c.urlEnv] = "http://10.0.0.5:8001";
      process.env[c.tokEnv] = "env-tok";
      save({ [c.urlKey]: "http://10.0.0.5:8001/api/" });
      assert.deepEqual(c.read(), { url: "http://10.0.0.5:8001/api", token: "env-tok" });
    });

    it("saved URL + saved token (env token also set): the saved token is used", () => {
      process.env[c.urlEnv] = "http://10.0.0.5:8001";
      process.env[c.tokEnv] = "env-tok";
      save({ [c.urlKey]: "http://10.9.9.9:8001", [c.tokKey]: "saved-tok" });
      assert.deepEqual(c.read(), { url: "http://10.9.9.9:8001", token: "saved-tok" });
    });

    it("saved URL + env token, no env URL: not connected", () => {
      process.env[c.tokEnv] = "env-tok";
      save({ [c.urlKey]: "http://10.9.9.9:8001" });
      assert.equal(c.read(), null);
    });
  });
}

describe("orchestraTokenSet matches what orchestraCredentials would use", () => {
  it("saved URL on another origin, token only in env: not set", () => {
    process.env.ORCHESTRA_URL = "http://10.0.0.5:8001";
    process.env.ORCHESTRA_TOKEN = "env-tok";
    save({ orchestraUrl: "http://10.9.9.9:8001" });
    assert.equal(orchestraTokenSet(), false);
    assert.equal(orchestraCredentials(), null);
  });

  it("saved URL on the env URL's origin, token in env: set", () => {
    process.env.ORCHESTRA_URL = "http://10.0.0.5:8001";
    process.env.ORCHESTRA_TOKEN = "env-tok";
    save({ orchestraUrl: "http://10.0.0.5:8001/x" });
    assert.equal(orchestraTokenSet(), true);
    assert.notEqual(orchestraCredentials(), null);
  });

  it("token saved in Settings, URL on another origin: set", () => {
    process.env.ORCHESTRA_URL = "http://10.0.0.5:8001";
    process.env.ORCHESTRA_TOKEN = "env-tok";
    save({ orchestraUrl: "http://10.9.9.9:8001", orchestraToken: "saved-tok" });
    assert.equal(orchestraTokenSet(), true);
    assert.notEqual(orchestraCredentials(), null);
  });
});

describe("settings replies use the origin-aware readers", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const raw = /systemSetting\("orchestraToken"|systemSetting\("orchestraUrl"|systemSetting\("hermesApiToken"|systemSetting\("hermesApiUrl"/;
  for (const [name, file] of [["GET /api/settings", "../app/api/settings/route.ts"], ["the system save reply", "../app/api/settings/system/route.ts"]]) {
    it(`${name} reports hermes, orchestra and the token from the readers`, () => {
      const src = read(file);
      assert.doesNotMatch(src, raw);
      assert.match(src, /orchestraTokenSet\(\)/);
      assert.match(src, /hermesCredentials\(\)/);
      assert.match(src, /orchestraCredentials\(\)/);
    });
  }
});

describe("hermes-ctl reads its token through the origin rule", () => {
  it("calls secretForSettingUrl for the token", () => {
    const src = readFileSync(new URL("./hermes-ctl.ts", import.meta.url), "utf8");
    assert.match(src, /secretForSettingUrl\("hermesApiUrl", "HERMES_API_URL", "hermesApiToken", "HERMES_API_TOKEN"\)/);
  });
});
