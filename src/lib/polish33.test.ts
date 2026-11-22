import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { searchPacks } from "./minecraft/packs.ts";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("polish 33", () => {
  it("both redirect callers name a redirect loop as too many redirects", () => {
    for (const f of ["./integration-client.ts", "./npm.ts"]) assert.ok(read(f).includes("redirected too many times."), f);
  });

  it("pack search: a body under the cap is read, a declared body over it is an error", async () => {
    const body = JSON.stringify({ hits: [] });
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
    assert.equal((await searchPacks("x", "modrinth")).modrinth, "ok");
    globalThis.fetch = (async () => new Response(body, { status: 200, headers: { "content-length": String(8 * 1024 * 1024) } })) as typeof fetch;
    assert.equal((await searchPacks("x", "modrinth")).modrinth, "error");
  });
});
