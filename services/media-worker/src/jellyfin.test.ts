import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { createJellyfin, mapPath } from "./jellyfin.ts";

const ROOTS = "movies=/media/movies,tv=/media/tv";
const KEY = "jf-secret-key-1234567890";

async function stub(status: number) {
  const seen: { url?: string; auth?: string; body?: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { seen.push({ url: req.url, auth: req.headers.authorization, body }); res.writeHead(status).end(); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("jellyfin (B7, D11)", () => {
  it("maps a library path through JELLYFIN_ROOTS", () => {
    assert.equal(mapPath("movies/A (2000)/A.mkv", ROOTS), "/media/movies/A (2000)/A.mkv");
    assert.equal(mapPath("music/x.mkv", ROOTS), null);
  });

  it("posts /Library/Media/Updated with the token header and the mapped path", async () => {
    const s = await stub(204);
    const j = createJellyfin({ JELLYFIN_URL: s.url, JELLYFIN_API_KEY: KEY, JELLYFIN_ROOTS: ROOTS }, () => {});
    assert.equal(await j.refresh("tv/Show/S01/e1.mkv"), "told");
    assert.equal(s.seen[0].url, "/Library/Media/Updated");
    assert.equal(s.seen[0].auth, `MediaBrowser Token="${KEY}"`);
    assert.deepEqual(JSON.parse(s.seen[0].body ?? ""), { Updates: [{ Path: "/media/tv/Show/S01/e1.mkv", UpdateType: "Modified" }] });
    await s.close();
  });

  it("a failing Jellyfin gives 'failed', never throws, and the key is not logged", async () => {
    const s = await stub(500);
    const logs: string[] = [];
    const j = createJellyfin({ JELLYFIN_URL: s.url, JELLYFIN_API_KEY: KEY, JELLYFIN_ROOTS: ROOTS }, (l) => logs.push(l));
    assert.equal(await j.refresh("movies/A/A.mkv"), "failed");
    assert.equal(logs.join("\n").includes(KEY), false);
    await s.close();
    const down = createJellyfin({ JELLYFIN_URL: "http://127.0.0.1:1", JELLYFIN_API_KEY: KEY, JELLYFIN_ROOTS: ROOTS }, () => {});
    assert.equal(await down.refresh("movies/A/A.mkv"), "failed");
  });

  it("with no key it is off, and logs that once", async () => {
    const logs: string[] = [];
    const j = createJellyfin({}, (l) => logs.push(l));
    assert.equal(await j.refresh("movies/A/A.mkv"), "off");
    assert.equal(await j.refresh("movies/B/B.mkv"), "off");
    assert.equal(logs.length, 1);
  });
});
