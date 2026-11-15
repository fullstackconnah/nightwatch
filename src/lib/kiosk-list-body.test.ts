import { test } from "node:test";
import assert from "node:assert/strict";
import { readListBody } from "./kiosk-list-store.ts";

const req = (chunks: Uint8Array[], headers: Record<string, string> = {}) => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({ pull(c) { if (pulled < chunks.length) c.enqueue(chunks[pulled++]); else c.close(); } });
  return { r: { headers: new Headers(headers), body }, pulled: () => pulled };
};
const enc = new TextEncoder();

test("1 a chunked body over 2048 bytes with no content-length stops reading and reports over-cap", async () => {
  const { r, pulled } = req(Array.from({ length: 50 }, () => new Uint8Array(1000)));
  const out = await readListBody(r);
  assert.equal(out.tooLarge, true);
  assert.ok(pulled() <= 5, "stopped reading at the cap, pulled " + pulled());
});

test("2 a small body is returned whole with or without content-length", async () => {
  const text = JSON.stringify({ a: 1 });
  for (const h of [{}, { "content-length": String(text.length) }, { "content-length": "abc" }]) {
    const out = await readListBody(req([enc.encode(text)], h).r);
    assert.deepEqual(out, { body: text, tooLarge: false });
  }
});

test("3 a declared content-length over the cap is over-cap", async () => {
  assert.equal((await readListBody(req([enc.encode("{}")], { "content-length": "5000" }).r)).tooLarge, true);
});
