import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getOrchestraSnapshot } from "./orchestra.ts";
import { getProxyManagerSnapshot } from "./npm.ts";
import { getWeather, WEATHER_UNCONFIGURED_DETAIL } from "./weather.ts";

const UNREADABLE =
  "The saved settings can't be read, so this is off until they are restored. Open Settings for details.";
const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");

describe("unreadable settings, remaining integrations", () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-unconf2-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("weather: readable keeps its detail, unreadable says so", async () => {
    writeFileSync(join(dir, "config.json"), "{}");
    assert.deepEqual(await getWeather(), { status: "unconfigured", detail: WEATHER_UNCONFIGURED_DETAIL });
    writeFileSync(join(dir, "config.json"), "{ nope");
    assert.deepEqual(await getWeather(), { status: "unconfigured", detail: UNREADABLE });
  });

  it("npm: readable keeps its detail, unreadable says so", async () => {
    writeFileSync(join(dir, "config.json"), "{}");
    const ok = await getProxyManagerSnapshot();
    assert.equal(ok.status, "unconfigured");
    assert.match(ok.detail ?? "", /No Nginx Proxy Manager connection configured/);
    writeFileSync(join(dir, "config.json"), "{ nope");
    const bad = await getProxyManagerSnapshot();
    assert.equal(bad.status, "unconfigured");
    assert.equal(bad.detail, UNREADABLE);
  });

  it("orchestra: readable keeps its detail, unreadable says so", async () => {
    writeFileSync(join(dir, "config.json"), "{}");
    const ok = await getOrchestraSnapshot(null);
    assert.equal(ok.status, "unconfigured");
    assert.match(ok.status === "unconfigured" ? ok.detail : "", /orchestra service is not connected/);
    writeFileSync(join(dir, "config.json"), "{ nope");
    const bad = await getOrchestraSnapshot(null);
    assert.equal(bad.status === "unconfigured" ? bad.detail : "", UNREADABLE);
  });

  // voice, forgejo and jellyfin import through the "@/" alias, which node:test can't load: their wiring is pinned by source.
  it("voice, forgejo and jellyfin route their unconfigured detail through the helper", () => {
    assert.doesNotMatch(src("./voice.ts"), /detail: VOICE_UNCONFIGURED_DETAIL\b/);
    assert.match(src("./voice.ts"), /unconfiguredDetail\(VOICE_UNCONFIGURED_DETAIL\)/);
    assert.match(src("./forgejo.ts"), /unconfiguredDetail\(/);
    assert.match(src("./jellyfin.ts"), /unconfiguredDetail\(/);
  });

  it("jellyfin tells the panel the settings are unreadable by reason, and the panel words it", () => {
    assert.match(src("./jellyfin.ts"), /configProblem\(\) === null \? "not-configured" : "settings-unreadable"/);
    assert.match(src("./types/transcode.ts"), /"settings-unreadable"/);
    const view = src("../components/resources/gpu-view.tsx");
    assert.match(view, /case "settings-unreadable":\s*return \{ headline: "Jellyfin settings unavailable", fix: null \}/);
    assert.match(view, /headline: "Jellyfin API key not configured"/);
  });
});
