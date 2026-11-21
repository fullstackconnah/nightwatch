import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchAllPages } from "./forgejo-pages.ts";

type Err = { ok: false; kind: "error"; detail: string };
const err: Err = { ok: false, kind: "error", detail: "boom" };
const items = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** A fetcher serving `total` numbered items in pages of 50; `failOn` makes that page fail. */
function serve(total: number, failOn?: number) {
  const pages: number[] = [];
  const fetchPage = async (page: number): Promise<{ ok: true; data: number[] } | Err> => {
    pages.push(page);
    if (page === failOn) return err;
    return { ok: true, data: items((page - 1) * 50, Math.max(0, Math.min(50, total - (page - 1) * 50))) };
  };
  return { pages, fetchPage };
}

describe("fetchAllPages", () => {
  it("0 items: one request, empty list", async () => {
    const s = serve(0);
    assert.deepEqual(await fetchAllPages(s.fetchPage), { ok: true, data: [] });
    assert.deepEqual(s.pages, [1]);
  });
  it("49 items: one request", async () => {
    const s = serve(49);
    const r = await fetchAllPages(s.fetchPage);
    assert.deepEqual(r, { ok: true, data: items(0, 49) });
    assert.deepEqual(s.pages, [1]);
  });
  it("exactly 50: a second request that comes back empty", async () => {
    const s = serve(50);
    assert.deepEqual(await fetchAllPages(s.fetchPage), { ok: true, data: items(0, 50) });
    assert.deepEqual(s.pages, [1, 2]);
  });
  it("120 items: three requests, in order", async () => {
    const s = serve(120);
    assert.deepEqual(await fetchAllPages(s.fetchPage), { ok: true, data: items(0, 120) });
    assert.deepEqual(s.pages, [1, 2, 3]);
  });
  it("page 1 failing is the result", async () => {
    const s = serve(120, 1);
    assert.deepEqual(await fetchAllPages(s.fetchPage), err);
    assert.deepEqual(s.pages, [1]);
  });
  it("page 2 failing is the result, not the first 50", async () => {
    const s = serve(120, 2);
    assert.deepEqual(await fetchAllPages(s.fetchPage), err);
    assert.deepEqual(s.pages, [1, 2]);
  });
  it("stops at 10 full pages: 500 items, no 11th request", async () => {
    const s = serve(1000);
    const r = await fetchAllPages(s.fetchPage);
    assert.deepEqual(r, { ok: true, data: items(0, 500) });
    assert.equal(s.pages.length, 10);
    assert.equal(Math.max(...s.pages), 10);
  });
});
