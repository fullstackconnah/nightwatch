import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GET } from "./route.ts";

const realFetch = globalThis.fetch;
const realEnv = { OLLAMA_URL: process.env.OLLAMA_URL, PUBLIC_HOST: process.env.PUBLIC_HOST };

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(realEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Replace global fetch: record each requested URL, then answer `res` or throw `res` if it is an Error. */
function stubFetch(res: Response | Error, seen: string[]) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    seen.push(String(url));
    if (res instanceof Error) throw res;
    return res;
  }) as typeof fetch;
}

const tags = () =>
  new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), {
    headers: { "Content-Type": "application/json" },
  });

describe("GET /api/hermes/local-models", () => {
  it("asks Ollama on the configured public host when OLLAMA_URL is unset", async () => {
    delete process.env.OLLAMA_URL;
    process.env.PUBLIC_HOST = "example-host";
    const seen: string[] = [];
    stubFetch(tags(), seen);
    const body = await (await GET()).json();
    assert.deepEqual(seen, ["http://example-host:11434/api/tags"]);
    assert.equal(body.reachable, true);
    assert.deepEqual(body.models, ["ollama/qwen3:8b"]);
  });

  it("uses OLLAMA_URL when it is set", async () => {
    process.env.OLLAMA_URL = "http://ollama.test:1";
    process.env.PUBLIC_HOST = "example-host";
    const seen: string[] = [];
    stubFetch(tags(), seen);
    await GET();
    assert.deepEqual(seen, ["http://ollama.test:1/api/tags"]);
  });

  it("keeps the URL and the host out of the not-reachable detail", async () => {
    delete process.env.OLLAMA_URL;
    process.env.PUBLIC_HOST = "example-host";
    stubFetch(new Error("connect ECONNREFUSED"), []);
    const body = await (await GET()).json();
    assert.equal(body.reachable, false);
    assert.equal(body.suggested, "hermes-local");
    assert.equal(body.detail.includes("http://"), false, body.detail);
    assert.equal(body.detail.includes("example-host"), false, body.detail);
  });
});
