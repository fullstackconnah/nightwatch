import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

/* Follow-up to hunt 98: the GPU view headline and Forgejo's sync message must not read as a timeout when the connection was refused. */
const dir = mkdtempSync(join(tmpdir(), "nw-unreach2-"));
writeFileSync(join(dir, "config.json"), JSON.stringify({ forgejo: { url: "http://forge.test", token: "t" } }));
process.env.DATA_DIR = dir;
const { triggerPushMirrorSync } = await import("./forgejo.ts");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const reject = (e: unknown) => { globalThis.fetch = (async () => { throw e; }) as typeof fetch; };

describe("triggerPushMirrorSync fetch failure", () => {
  it("a refused connection reads as not reachable", async () => {
    reject(new TypeError("fetch failed"));
    assert.deepEqual(await triggerPushMirrorSync("lab", "a"), { ok: false, status: 502, detail: "Forgejo is not reachable." });
  });
  it("a real timeout keeps a did-not-respond sentence with the seconds", async () => {
    reject(new DOMException("timed out", "TimeoutError"));
    const r = await triggerPushMirrorSync("lab", "a");
    assert.ok(!r.ok && r.status === 502);
    assert.match(!r.ok ? r.detail : "", /^Forgejo did not respond to the sync request within \d+s\.$/);
  });
});

describe("GPU view unreachable headline", () => {
  const src = readFileSync(new URL("../components/resources/gpu-view.tsx", import.meta.url), "utf8");
  it("says unreachable, true for a refusal and a timeout", () => {
    const body = src.slice(src.indexOf('case "unreachable":'), src.indexOf('case "unauthorized":'));
    assert.ok(body.includes('headline: "Jellyfin is unreachable"'));
    assert.ok(!src.includes("Jellyfin did not respond"));
  });
});
