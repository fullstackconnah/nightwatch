import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

/* Behavioural: stub global fetch, point DATA_DIR at a synthetic config, call the real forgejo.ts. */
const dir = mkdtempSync(join(tmpdir(), "nw-forgejo-"));
writeFileSync(join(dir, "config.json"), JSON.stringify({ forgejo: { url: "http://forge.test", token: "t" } }));
process.env.DATA_DIR = dir;
const { buildGitSnapshot, triggerPushMirrorSync } = await import("./forgejo.ts");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const repoRow = { id: 1, name: "a", full_name: "lab/a", owner: { login: "lab" }, html_url: "http://forge.test/lab/a", default_branch: "main", updated_at: "2026-11-01T00:00:00Z" };
/** Answers /repos/search with one repo, and each per-repo call from `byPath` (a Response) or an empty 200 list. */
function stub(byPath: Record<string, Response> = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("/repos/search")) return json({ data: [repoRow] });
    for (const [k, v] of Object.entries(byPath)) if (u.includes(k)) return v.clone();
    return json([]);
  }) as typeof fetch;
}
const creds = { url: "http://forge.test", token: "t" };

describe("buildGitSnapshot partial", () => {
  it("counts a repo with a failed call, and stays ok", async () => {
    stub({ "/pulls": json({}, 500) });
    const s = await buildGitSnapshot(creds);
    assert.equal(s.status, "ok");
    assert.equal(s.status === "ok" && s.partial, 1);
  });
  it("is 0 when every call answers", async () => {
    stub();
    const s = await buildGitSnapshot(creds);
    assert.equal(s.status === "ok" && s.partial, 0);
  });
  it("does not count an empty repository's commits 409", async () => {
    stub({ "/commits": json({ message: "Git Repository is empty." }, 409) });
    const s = await buildGitSnapshot(creds);
    assert.equal(s.status === "ok" && s.partial, 0);
  });
});

describe("triggerPushMirrorSync upstream auth", () => {
  it("answers 502 with the token sentence for an upstream 401 or 403", async () => {
    for (const code of [401, 403]) {
      globalThis.fetch = (async () => new Response(null, { status: code })) as typeof fetch;
      const r = await triggerPushMirrorSync("lab", "a");
      assert.deepEqual(r, { ok: false, status: 502, detail: "Forgejo refused the saved token. Check the Forgejo token in Settings." });
    }
  });
  it("leaves 404 as it was", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const r = await triggerPushMirrorSync("lab", "a");
    assert.deepEqual(r, { ok: false, status: 404, detail: "That repo or mirror no longer exists." });
  });
});

describe("buildGitSnapshot branch and pull counts", () => {
  it("asks for full pages and counts off-default branches before the display cap", async () => {
    const urls: string[] = [];
    const repos = ["a", "b", "c"].map((n, i) => ({ ...repoRow, id: i + 1, name: n, full_name: `lab/${n}`, html_url: `http://forge.test/lab/${n}` }));
    const branchList = [{ name: "main", commit: { timestamp: "2026-11-01T00:00:00Z" } }, ...Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, commit: { timestamp: "2026-11-01T00:00:00Z" } }))];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      urls.push(u);
      if (u.includes("/repos/search")) return json({ data: repos });
      if (u.includes("/branches")) return json(branchList);
      return json([]);
    }) as typeof fetch;
    const s = await buildGitSnapshot(creds);
    assert.equal(s.status, "ok");
    if (s.status !== "ok") return;
    assert.equal(s.offDefaultCount, 90);
    assert.equal(s.branches.length, 60);
    assert.equal(urls.filter((u) => u.endsWith("/branches?limit=50")).length, 3);
    assert.equal(urls.filter((u) => u.endsWith("/pulls?state=open&limit=50")).length, 3);
  });
});
