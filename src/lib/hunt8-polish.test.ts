import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadConfig, loadConfigForSave } from "./config.ts";
import type { AppConfig } from "./config.ts";
import { mergeDashPut } from "./settings/dash-put.ts";
import { readCapped } from "./read-capped.ts";
import { cachedByKey } from "./weather-cache.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("hunt 8 polish 1: widget lookup guards stay", () => {
  it("widgets/index.ts uses pickOwn and labelUrlInvalid", () => {
    const src = read("./widgets/index.ts");
    assert.ok(src.includes("pickOwn("));
    assert.ok(src.includes("labelUrlInvalid("));
  });
});

describe("hunt 8 polish 2: label: widget ids", () => {
  const cur = { widgets: [], groups: [] } as unknown as AppConfig;
  it("a saved widget id starting with label: is refused", () => {
    assert.deepEqual(mergeDashPut(cur, { widgets: [{ id: "label:abc", type: "clock" }] }), { error: `Widget ids can't start with "label:"` });
  });
  it("other ids still merge", () => {
    assert.ok("next" in mergeDashPut(cur, { widgets: [{ id: "w_label:x", type: "clock" }] }));
  });
});

describe("hunt 8 polish 5: size caps in mergeDashPut", () => {
  const cur = { widgets: [], groups: [] } as unknown as AppConfig;
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, type: "clock", name: `g${i}` }));
  it("500 widgets pass, 501 are refused", () => {
    assert.ok("next" in mergeDashPut(cur, { widgets: many(500) }));
    assert.deepEqual(mergeDashPut(cur, { widgets: many(501) }), { error: "Too many widgets (the most is 500)" });
  });
  it("200 groups pass, 201 are refused", () => {
    assert.ok("next" in mergeDashPut(cur, { groups: many(200) }));
    assert.deepEqual(mergeDashPut(cur, { groups: many(201) }), { error: "Too many groups (the most is 200)" });
  });
  it("the settings route reads the body with readCapped and caps it at 1 MB with a 413", () => {
    const src = read("../app/api/settings/route.ts");
    assert.ok(src.includes("readCapped(req, MAX_BODY_BYTES"));
    assert.ok(src.includes("status: 413"));
    assert.ok(src.includes("Settings are too large to save."));
  });
});

describe("hunt 8 polish 3: strict read needs a plain object", () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "nw-h8p-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  for (const [kind, text] of [["null", "null"], ["array", "[]"], ["number", "7"], ["string", '"x"']]) {
    it(`${kind} throws on a save read, the tolerant read gives defaults`, () => {
      writeFileSync(join(dir, "config.json"), text);
      assert.throws(() => loadConfigForSave(), /nothing was saved/);
      assert.deepEqual(loadConfig().widgets, []);
    });
  }
});

describe("hunt 8 polish 6: weather cache", () => {
  const ttl = (v: string) => (v === "ok" ? 600_000 : 30_000);
  it("two concurrent calls make one load", async () => {
    let n = 0;
    const get = cachedByKey<string>(ttl, () => 0);
    const load = async () => { n++; return "ok"; };
    await Promise.all([get("a", load), get("a", load)]);
    assert.equal(n, 1);
  });
  it("a changed key reloads at once", async () => {
    let n = 0;
    const get = cachedByKey<string>(ttl, () => 0);
    const load = async () => { n++; return "ok"; };
    await get("a", load); await get("a", load); await get("b", load);
    assert.equal(n, 2);
  });
  it("a failure is served from cache for 30 s, then refetched; a good answer keeps 10 min", async () => {
    let t = 0, n = 0, answer = "unreachable";
    const get = cachedByKey<string>(ttl, () => t);
    const load = async () => { n++; return answer; };
    await get("a", load);
    t = 29_000; await get("a", load);
    assert.equal(n, 1);
    t = 31_000; answer = "ok"; await get("a", load);
    assert.equal(n, 2);
    t = 31_000 + 599_000; await get("a", load);
    assert.equal(n, 2);
    t = 31_000 + 601_000; await get("a", load);
    assert.equal(n, 3);
  });
  it("getWeather does not cache unconfigured: it checks the config before the cache", () => {
    const src = read("./weather.ts");
    assert.ok(src.indexOf("displayConfig()", src.indexOf("export async function getWeather")) < src.indexOf("cachedWeather(", src.indexOf("export async function getWeather")));
  });
});

describe("hunt 8 polish 7: readCapped", () => {
  const body = (s: string) => new Response(s);
  it("a body under the cap is read whole", async () => {
    assert.equal(await readCapped(body("hello"), 100), "hello");
  });
  it("a body over the cap stops at the cap", async () => {
    const out = await readCapped(body("x".repeat(5000)), 1000);
    assert.ok(out !== null && out.length === 1000);
  });
  it("a content-length over the cap returns null without reading", async () => {
    const res = new Response("tiny", { headers: { "content-length": "5000" } });
    assert.equal(await readCapped(res, 1000), null);
  });
  it("a content-length over the cap cancels the body stream", async () => {
    let cancelled = false;
    const res = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": "5000" } });
    assert.equal(await readCapped(res, 1000), null);
    assert.ok(cancelled);
  });
  it("no content-length header still caps the stream", async () => {
    const res = new Response(new ReadableStream({
      pull(c) { c.enqueue(new TextEncoder().encode("y".repeat(400))); },
    }));
    const out = await readCapped(res, 1000);
    assert.ok(out !== null && out.length === 1000);
  });
});
