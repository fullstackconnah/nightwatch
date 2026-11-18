import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { unconfiguredDetail } from "./config.ts";
import { IntegrationClient } from "./integration-client.ts";

const UNREADABLE =
  "The saved settings can't be read, so this is off until they are restored. Open Settings for details.";

class Client extends IntegrationClient<{ url: string; token: string }> {
  protected readonly displayName = "Test";
  protected readonly timeoutMs = 1000;
  protected readonly unconfiguredDetail = "Add a block to data/config.json.";
  protected credentials() {
    return null;
  }
  protected baseUrl(c: { url: string }) {
    return c.url;
  }
  protected authHeaders() {
    return {};
  }
  get(path: string) {
    return this.request<unknown>(path);
  }
}

describe("unconfiguredDetail", () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-unconf-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes the detail through when the settings are readable", () => {
    writeFileSync(join(dir, "config.json"), "{}");
    assert.equal(unconfiguredDetail("add a block"), "add a block");
  });

  it("says the settings can't be read when config.json is unreadable", () => {
    writeFileSync(join(dir, "config.json"), "{ nope");
    assert.equal(unconfiguredDetail("add a block"), UNREADABLE);
  });

  it("says it for a blank file beside a last-good copy", () => {
    writeFileSync(join(dir, "config.json"), "");
    writeFileSync(join(dir, "config.json.bak"), "{}");
    assert.equal(unconfiguredDetail("add a block"), UNREADABLE);
  });

  it("IntegrationClient resolves it at call time, keeping status unconfigured", async () => {
    const c = new Client();
    assert.deepEqual(await c.get("/x"), { status: "unconfigured", detail: "Add a block to data/config.json." });
    writeFileSync(join(dir, "config.json"), "{ nope");
    assert.deepEqual(await c.get("/x"), { status: "unconfigured", detail: UNREADABLE });
  });

  it("every direct unconfigured return site goes through the helper", () => {
    const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
    const bare = /detail: (UNCONFIGURED_DETAIL|HERMES_UNCONFIGURED_DETAIL|BRIEFING_UNCONFIGURED_DETAIL)\b/;
    for (const f of ["./ha.ts", "./ha-doorbell.ts", "./hermes-ctl.ts", "./briefing.ts"]) {
      assert.doesNotMatch(src(f), bare, f);
      assert.match(src(f), /unconfiguredDetail\(/, f);
    }
  });
});
