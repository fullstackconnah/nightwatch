import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { vikunja } from "./vikunja.ts";
import { mergeDashPut } from "../settings/dash-put.ts";
import type { AppConfig, WidgetInstance } from "../config.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; auth: string | null };
function stub(headers: Record<string, string> | ((url: string) => Record<string, string>), status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return new Response("[]", { status, headers: typeof headers === "function" ? headers(url) : headers });
  }) as typeof fetch;
  return calls;
}

const w = (extra: Partial<WidgetInstance> = {}) =>
  ({ id: "v1", container: "vikunja", type: "vikunja", url: "http://tasks.example.test/", key: "tok", ...extra }) as WidgetInstance;
const run = (inst: WidgetInstance) => vikunja(inst);

describe("vikunja widget", () => {
  it("one request per field with the encoded filter, per_page=1 and the Bearer header", async () => {
    const calls = stub({ "X-Pagination-Total-Pages": "7", "X-Pagination-Result-Count": "1" });
    const out = await run(w({ fields: [{ label: "Open", path: "done = false" }, { label: "Bug", path: "labels = 5" }] }));
    assert.deepEqual(out, [{ label: "Open", value: "7" }, { label: "Bug", value: "7" }]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `http://tasks.example.test/api/v1/tasks?per_page=1&filter=${encodeURIComponent("done = false")}`);
    assert.ok(calls[1].url.endsWith(`filter=${encodeURIComponent("labels = 5")}`));
    assert.equal(calls[0].auth, "Bearer tok");
  });
  it("a result count of 0 is 0 even when total pages says 1", async () => {
    stub({ "X-Pagination-Total-Pages": "1", "X-Pagination-Result-Count": "0" });
    assert.equal((await run(w({ fields: [{ label: "A", path: "done = true" }] })))[0].value, "0");
  });
  it("no fields gives one Open field filtering done = false", async () => {
    const calls = stub({ "X-Pagination-Total-Pages": "3", "X-Pagination-Result-Count": "1" });
    assert.deepEqual(await run(w()), [{ label: "Open", value: "3" }]);
    assert.ok(calls[0].url.endsWith(`filter=${encodeURIComponent("done = false")}`));
  });
  it("a missing count header and an HTTP error are errors", async () => {
    stub({});
    await assert.rejects(run(w()), { message: "no count header" });
    stub({}, 401);
    await assert.rejects(run(w()), { message: "HTTP 401" });
  });
  it("a missing token is an error and sends nothing", async () => {
    const calls = stub({});
    await assert.rejects(run(w({ key: undefined })), { message: "no API token" });
    assert.equal(calls.length, 0);
  });
  it("only the first 4 fields are fetched", async () => {
    const calls = stub({ "X-Pagination-Total-Pages": "1", "X-Pagination-Result-Count": "1" });
    const fields = Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, path: `labels = ${i}` }));
    assert.equal((await run(w({ fields }))).length, 4);
    assert.equal(calls.length, 4);
  });
  it("a Settings save keeps the stored fields and key", () => {
    const stored = w({ fields: [{ label: "Open", path: "done = false" }] });
    const current = { widgets: [stored] } as unknown as AppConfig;
    const { key: _k, ...sent } = stored; // the browser never holds the key
    const r = mergeDashPut(current, { widgets: [{ ...sent, keySet: true }] });
    assert.ok("next" in r);
    assert.deepEqual(r.next.widgets, [stored]);
  });
});
