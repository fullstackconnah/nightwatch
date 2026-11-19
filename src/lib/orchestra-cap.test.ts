import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, describe, it } from "node:test";

// orchestra.ts pulls in config.ts, which imports "@/lib/..."; map it for this process only.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  return next(s, c);
}`));
const { getOrchestraSnapshot } = await import("./orchestra.ts");

const MB = 1024 * 1024;
const creds = { url: "http://orchestra.test:1", token: "test-only-token" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const stub = (res: Response) => {
  globalThis.fetch = (async () => res) as typeof fetch;
};

describe("orchestra client upstream body cap", () => {
  it("still maps a normal body to ok", async () => {
    stub(new Response(JSON.stringify({ orchestrators: [{ name: "nightwatch" }] }), { status: 200 }));
    const s = await getOrchestraSnapshot(creds);
    assert.equal(s.status, "ok");
    assert.equal(s.orchestrators.length, 1);
  });

  it("answers unreachable for a Content-Length over 1 MB, without reading the body", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (++pulls > 1) c.close(); else c.enqueue(new Uint8Array(1024)); } }, { highWaterMark: 0 });
    stub(new Response(body, { status: 200, headers: { "content-length": String(MB + 1) } }));
    const s = await getOrchestraSnapshot(creds);
    assert.equal(s.status, "unreachable");
    assert.equal(pulls, 0);
  });

  it("stops reading a long chunked body at the 1 MB cap and answers unreachable", async () => {
    let pulls = 0;
    // 8 MB in all, so old uncapped code reads 32 chunks and ends; the capped client stops after about 4.
    const body = new ReadableStream<Uint8Array>(
      { pull(c) { if (++pulls > 32) c.close(); else c.enqueue(new Uint8Array(256 * 1024).fill(0x78)); } },
      { highWaterMark: 0 },
    );
    stub(new Response(body, { status: 200 }));
    const s = await getOrchestraSnapshot(creds);
    assert.equal(s.status, "unreachable");
    assert.ok(pulls <= 5, `pulled ${pulls} chunks`);
  });

  it("answers unreachable for a non-JSON body", async () => {
    stub(new Response("<html>nope</html>", { status: 200 }));
    assert.equal((await getOrchestraSnapshot(creds)).status, "unreachable");
  });
});
