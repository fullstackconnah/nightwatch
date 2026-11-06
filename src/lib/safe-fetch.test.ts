import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchNoCrossOriginRedirect } from "./safe-fetch.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; init: RequestInit };
function stub(...replies: Response[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return replies[calls.length - 1] ?? new Response("end", { status: 200 });
  }) as typeof fetch;
  return calls;
}
const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } });

describe("fetchNoCrossOriginRedirect", () => {
  it("passes a 200 straight through, asking for a manual redirect", async () => {
    const calls = stub(new Response("ok"));
    const res = await fetchNoCrossOriginRedirect("http://a.test/x", { headers: { "X-Api-Key": "k" } });
    assert.equal(await res.text(), "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.redirect, "manual");
  });

  it("follows a same-origin 301 and keeps the headers", async () => {
    const calls = stub(redirect(301, "http://a.test/api/"), new Response("ok"));
    const res = await fetchNoCrossOriginRedirect("http://a.test/api", { headers: { "X-Api-Key": "k" } });
    assert.equal(res.status, 200);
    assert.equal(calls[1].url, "http://a.test/api/");
    assert.deepEqual(calls[1].init.headers, { "X-Api-Key": "k" });
  });

  it("resolves a relative Location", async () => {
    const calls = stub(redirect(302, "/v2/x"), new Response("ok"));
    await fetchNoCrossOriginRedirect("http://a.test/v1/x", {});
    assert.equal(calls[1].url, "http://a.test/v2/x");
  });

  it("throws on a cross-origin 302 and never calls the other host", async () => {
    const calls = stub(redirect(302, "http://evil.test/steal"), new Response("leak"));
    await assert.rejects(fetchNoCrossOriginRedirect("http://a.test/x", { headers: { "X-Api-Key": "k" } }), /redirected to another host/);
    assert.equal(calls.length, 1);
  });

  it("counts a scheme change on the same host as cross-origin", async () => {
    const calls = stub(redirect(301, "https://a.test/x"));
    await assert.rejects(fetchNoCrossOriginRedirect("http://a.test/x", {}), /redirected to another host/);
    assert.equal(calls.length, 1);
  });

  it("throws on the 4th hop", async () => {
    const calls = stub(redirect(302, "/1"), redirect(302, "/2"), redirect(302, "/3"), redirect(302, "/4"));
    await assert.rejects(fetchNoCrossOriginRedirect("http://a.test/0", {}), /redirected to another host/);
    assert.equal(calls.length, 4);
  });

  it("turns a 303 after a POST into a GET with no body", async () => {
    const calls = stub(redirect(303, "/done"), new Response("ok"));
    await fetchNoCrossOriginRedirect("http://a.test/act", { method: "POST", body: "secret" });
    assert.equal(calls[1].init.method, "GET");
    assert.equal(calls[1].init.body, undefined);
  });
});
