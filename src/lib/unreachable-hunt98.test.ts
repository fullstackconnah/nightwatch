import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { IntegrationClient } from "./integration-client.ts";

/* Hunt 98: a refused connection or a DNS failure is "not reachable", never a timeout. Only a real timeout says "did not respond within". */

const dir = mkdtempSync(join(tmpdir(), "nw-unreach-"));
writeFileSync(join(dir, "config.json"), JSON.stringify({ forgejo: { url: "http://forge.test", token: "t" } }));
process.env.DATA_DIR = dir;
const { buildGitSnapshot } = await import("./forgejo.ts");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const failWith = (e: Error) => { globalThis.fetch = (async () => { throw e; }) as typeof fetch; };
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

class TestClient extends IntegrationClient<{ url: string }> {
  protected readonly displayName = "Test Service";
  protected readonly timeoutMs = 4000;
  protected readonly unconfiguredDetail = "Test Service is not configured.";
  protected credentials() { return { url: "http://svc" }; }
  protected baseUrl(c: { url: string }) { return c.url; }
  protected authHeaders() { return {}; }
  get() { return this.request<unknown>("/x"); }
}
// Mirrors src/lib/media/worker.ts: an override that takes no arguments and answers the same for both cases.
class OverrideClient extends TestClient {
  protected unreachableDetail(): string { return "The media worker didn’t answer."; }
}

const src = (...p: string[]) => readFileSync(new URL(join("..", ...p), import.meta.url), "utf8");

describe("shared IntegrationClient", () => {
  it("says not reachable for a refused connection", async () => {
    failWith(refused());
    const p = await new TestClient().get();
    assert.equal(p.status === "unreachable" && p.detail, "Test Service is not reachable.");
    assert.equal(p.timedOut, undefined);
  });
  it("says not reachable for a plain network error", async () => {
    failWith(new Error("ECONNREFUSED"));
    const p = await new TestClient().get();
    assert.equal(p.status === "unreachable" && p.detail, "Test Service is not reachable.");
  });
  it("keeps the timeout text for a TimeoutError", async () => {
    failWith(timeout());
    const p = await new TestClient().get();
    assert.equal(p.status === "unreachable" && p.detail, "Test Service did not respond within 4s.");
    assert.equal(p.timedOut, true);
  });
  it("keeps the timeout text for undici's headers timeout", async () => {
    failWith(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }));
    const p = await new TestClient().get();
    assert.equal(p.status === "unreachable" && p.detail, "Test Service did not respond within 4s.");
  });
  it("a subclass override still wins for both cases", async () => {
    for (const e of [refused(), timeout()]) {
      failWith(e);
      const p = await new OverrideClient().get();
      assert.equal(p.status === "unreachable" && p.detail, "The media worker didn’t answer.");
    }
  });
});

describe("Forgejo", () => {
  it("says not reachable for a refused connection and keeps the timeout text", async () => {
    failWith(refused());
    const a = await buildGitSnapshot({ url: "http://forge.test", token: "t" });
    assert.equal(a.status === "unreachable" && a.detail, "Forgejo is not reachable.");
    failWith(timeout());
    const b = await buildGitSnapshot({ url: "http://forge.test", token: "t" });
    assert.equal(b.status === "unreachable" && b.detail, "Forgejo did not respond within 5s.");
  });
});

// npm.ts, hermes-ctl.ts and weather.ts need the server's config or a path alias, so they are pinned by source (voice-cleanup-hunt19 shape).
describe("catch sites without a stub harness", () => {
  const sites: [string, string, string][] = [
    ["npm.ts", "NPM is not reachable.", "NPM did not respond within"],
    ["hermes-ctl.ts", "is not reachable.", "did not respond within"],
    ["weather.ts", "Open-Meteo is not reachable.", "Open-Meteo did not respond within"],
  ];
  for (const [file, fresh, old] of sites) {
    it(`${file} tells a timeout from other failures`, () => {
      const s = src("lib", file);
      assert.match(s, /catch \(e\)/);
      assert.match(s, /isTimeout\(e\)/);
      assert.ok(s.includes(fresh), `${file} carries "${fresh}"`);
      assert.ok(s.includes(old), `${file} keeps the timeout wording`);
      assert.doesNotMatch(s, /\} catch \{\s*\n\s*return [^\n]*did not respond within/);
    });
  }
  it("npm.ts has both catches fixed", () => {
    assert.equal(src("lib", "npm.ts").split("NPM is not reachable.").length - 1, 2);
  });
});
