import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bearerOk } from "./auth.ts";
import { startServer } from "./server.ts";
import { start, TOKEN, tempDir, type Started } from "./testkit.ts";

describe("bearerOk", () => {
  it("accepts the exact token", () => assert.equal(bearerOk(`Bearer ${TOKEN}`, TOKEN), true));
  it("refuses a missing header", () => assert.equal(bearerOk(undefined, TOKEN), false));
  it("refuses a wrong token of the same length", () => {
    assert.equal(bearerOk(`Bearer ${TOKEN.slice(0, -1)}X`, TOKEN), false);
  });
  it("refuses a wrong-length token without throwing", () => {
    assert.doesNotThrow(() => bearerOk("Bearer wrong", TOKEN));
    assert.equal(bearerOk("Bearer wrong", TOKEN), false);
    assert.equal(bearerOk(`Bearer ${TOKEN}extra`, TOKEN), false);
  });
  it("refuses other schemes and an empty bearer", () => {
    assert.equal(bearerOk(`Basic ${TOKEN}`, TOKEN), false);
    assert.equal(bearerOk("Bearer ", TOKEN), false);
  });
});

describe("worker http auth", () => {
  let s: Started | undefined;
  afterEach(async () => { await s?.stop(); s = undefined; });

  it("no header is 401", async () => {
    s = await start();
    const res = await fetch(`${s.base}/library`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("a wrong token is 401", async () => {
    s = await start();
    assert.equal((await fetch(`${s.base}/library`, { headers: { authorization: "Bearer wrong" } })).status, 401);
  });

  it("a token of a different length is 401, not a crash", async () => {
    s = await start();
    const res = await fetch(`${s.base}/library`, { headers: { authorization: `Bearer ${TOKEN}${TOKEN}` } });
    assert.equal(res.status, 401);
    assert.equal((await fetch(`${s.base}/health`)).status, 200);
  });

  it("the right token is 200", async () => {
    s = await start();
    assert.equal((await fetch(`${s.base}/library`, { headers: s.auth })).status, 200);
  });

  it("startServer refuses a short token", () => {
    assert.throws(
      () => startServer({ token: "short", mediaRoot: tempDir(), stateDir: tempDir() }),
      /MEDIA_WORKER_TOKEN must be at least 32 characters/,
    );
  });

  it("GET /health needs no auth and shows no path", async () => {
    s = await start();
    const res = await fetch(`${s.base}/health`);
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.ok, true);
    assert.equal(body.compressEnabled, false);
    assert.doesNotMatch(text, /path|\/mnt|\/state/i);
  });

  it("a body over 16 KB is 413", async () => {
    s = await start();
    const res = await fetch(`${s.base}/scan`, {
      method: "POST", headers: { ...s.auth, "content-type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(20 * 1024) }),
    });
    assert.equal(res.status, 413);
  });

  it("the token never appears in a response or a log line", async () => {
    s = await start();
    const bodies = [
      await (await fetch(`${s.base}/library`, { headers: s.auth })).text(),
      await (await fetch(`${s.base}/library`)).text(),
      await (await fetch(`${s.base}/health`)).text(),
      await (await fetch(`${s.base}/nope`, { headers: s.auth })).text(),
    ];
    for (const b of bodies) assert.ok(!b.includes(TOKEN));
    assert.ok(!s.logs.join("\n").includes(TOKEN));
  });
});
