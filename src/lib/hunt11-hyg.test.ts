import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { readCapped, readJsonCapped } from "./read-capped.ts";
import { searchSelected } from "./minecraft/packs.ts";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("hunt 11 capped reads", () => {
  it("a stream whose cancel rejects still returns the capped text", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new TextEncoder().encode("abcdefgh")); },
      cancel() { return Promise.reject(new Error("boom")); },
    });
    assert.equal(await readCapped({ headers: new Headers(), body }, 4), "abcd");
  });
  it("readJsonCapped parses a body under the cap and refuses one over it", async () => {
    assert.deepEqual(await readJsonCapped(new Response('{"a":1}'), 100), { a: 1 });
    await assert.rejects(readJsonCapped(new Response('{"a":1}', { headers: { "content-length": "500" } }), 100));
    await assert.rejects(readJsonCapped(new Response('{"a":"' + "x".repeat(200) + '"}'), 100));
  });
  it("none of the four upstream sites calls res.json()", () => {
    for (const f of ["../app/api/hermes/local-models/route.ts", "../app/api/hermes/openrouter-models/route.ts", "./weather.ts", "./forgejo.ts"]) {
      const src = read(f);
      assert.ok(!/res\.json\(\)/.test(src), f);
      assert.ok(src.includes("readJsonCapped"), f);
    }
  });
});

describe("hunt 11 fixed error text", () => {
  it("rcon, hermes model and docker volumes send fixed text and log the real error", () => {
    for (const [f, text] of [
      ["../app/api/minecraft/rcon/route.ts", '"RCON command failed."'],
      ["../app/api/hermes/model/route.ts", '"Save failed."'],
      ["../app/api/docker/volumes/route.ts", '"Docker unreachable."'],
    ] as const) {
      const src = read(f);
      assert.ok(!src.includes("e.message"), f);
      assert.ok(src.includes(text), f);
      assert.ok(src.includes("console.error("), f);
    }
  });
  it("the upload proxy maps upstream 401/403 to 502 and slices the detail", () => {
    const src = read("../app/api/minecraft/instances/upload/route.ts");
    assert.ok(src.includes("res.status === 401 || res.status === 403 ? 502"));
    assert.ok(src.includes("body.detail.slice(0, 200)"));
  });
});

describe("hunt 11 pack search", () => {
  const calls: string[] = [];
  const cf = async () => (calls.push("cf"), { status: "ok" as const, results: [] });
  const mr = async () => (calls.push("mr"), { status: "ok" as const, results: [] });
  it("runs only the named provider; no source runs both", async () => {
    calls.length = 0;
    await searchSelected("x", "modrinth", "k", cf, mr);
    assert.deepEqual(calls, ["mr"]);
    calls.length = 0;
    await searchSelected("x", "curseforge", "k", cf, mr);
    assert.deepEqual(calls, ["cf"]);
    calls.length = 0;
    await searchSelected("x", "all", "k", cf, mr);
    assert.deepEqual(calls.sort(), ["cf", "mr"]);
  });
});
