import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import { getOrchestraDetail, getOrchestraSnapshot, ORCHESTRA_NAME } from "./orchestra.ts";

const TOKEN = "tok-SECRET-123";
const requests: string[] = [];
const servers: Server[] = [];

type Reply = { code: number; body?: unknown } | "hang";
async function stub(handler: (url: string, auth: string | undefined) => Reply) {
  const s = createServer((req, res) => {
    requests.push(req.url ?? "");
    const r = handler(req.url ?? "", req.headers.authorization);
    if (r === "hang") return;
    res.writeHead(r.code, { "content-type": "application/json" });
    res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}));
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  servers.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
after(() => servers.forEach((s) => (s.closeAllConnections(), s.close())));

const dev = {
  name: "dev", title: "Dev", state: "running", lastActivityAt: "2026-10-31T01:00:00Z", model: "opus",
  home: "F:\\x", inFlightCount: 2, stalledCount: 1, watcher: "online", pid: null, costToday: null,
};

describe("getOrchestraSnapshot", () => {
  it("unset url/token is unconfigured", async () => {
    assert.equal((await getOrchestraSnapshot(null)).status, "unconfigured");
  });
  it("401 and 403 are unauthorized", async () => {
    for (const code of [401, 403]) {
      const url = await stub(() => ({ code }));
      assert.equal((await getOrchestraSnapshot({ url, token: TOKEN })).status, "unauthorized");
    }
  });
  it("refused, unresolvable, non-2xx and bad JSON are unreachable", async () => {
    const dead = await stub(() => ({ code: 200 }));
    await new Promise((ok) => servers.pop()!.close(ok));
    assert.equal((await getOrchestraSnapshot({ url: dead, token: TOKEN })).status, "unreachable");
    assert.equal((await getOrchestraSnapshot({ url: "http://orchestra.invalid", token: TOKEN })).status, "unreachable");
    assert.equal((await getOrchestraSnapshot({ url: await stub(() => ({ code: 500 })), token: TOKEN })).status, "unreachable");
    assert.equal((await getOrchestraSnapshot({ url: await stub(() => ({ code: 200, body: "nope{" })), token: TOKEN })).status, "unreachable");
  });
  it("200 is ok, sends the bearer, maps orchestrators and drops junk", async () => {
    let auth: string | undefined;
    const url = await stub((_u, a) => ((auth = a), { code: 200, body: { orchestrators: [dev, { bogus: true }] } }));
    const snap = await getOrchestraSnapshot({ url: url + "/", token: TOKEN });
    assert.equal(auth, `Bearer ${TOKEN}`);
    assert.equal(snap.status, "ok");
    assert.equal(snap.orchestrators.length, 1);
    assert.deepEqual(snap.orchestrators[0], {
      name: "dev", title: "Dev", state: "running", lastActivityAt: "2026-10-31T01:00:00Z", model: "opus",
      home: "F:\\x", inFlightCount: 2, stalledCount: 1, watcher: "online", inFlight: [],
    });
  });
  it("keeps each agent's valid waiting, turns every bad shape into null and drops where and costToday", async () => {
    const agents = [
      { name: "ok", quietMin: 2, where: "F:\\secret", waiting: { tool: "Bash", sinceMin: 7 } },
      { name: "long", quietMin: 2, waiting: { tool: "T".repeat(80), sinceMin: 0 } },
      { name: "notool", quietMin: 2, waiting: { tool: "", sinceMin: 7 } },
      { name: "nonum", quietMin: 2, waiting: { tool: "Bash", sinceMin: "7" } },
      { name: "neg", quietMin: 2, waiting: { tool: "Bash", sinceMin: -1 } },
      { name: "nan", quietMin: 2, waiting: { tool: "Bash", sinceMin: null } },
      { name: "str", quietMin: 2, waiting: "Bash" },
      { name: "none", quietMin: null },
      { bogus: true },
    ];
    const url = await stub(() => ({ code: 200, body: { orchestrators: [{ ...dev, inFlight: agents }] } }));
    const snap = await getOrchestraSnapshot({ url, token: TOKEN });
    const got = snap.orchestrators[0].inFlight;
    assert.deepEqual(got.map((a) => a.name), ["ok", "long", "notool", "nonum", "neg", "nan", "str", "none"]);
    assert.deepEqual(got[0], { name: "ok", quietMin: 2, waiting: { tool: "Bash", sinceMin: 7 } });
    assert.deepEqual(got[1].waiting, { tool: "T".repeat(64), sinceMin: 0 });
    assert.deepEqual(got.slice(2).map((a) => a.waiting), [null, null, null, null, null, null]);
    assert.equal(got[7].quietMin, null);
    assert.ok(!JSON.stringify(snap).includes("secret"));
    assert.ok(!("costToday" in snap.orchestrators[0]));
  });
  it("a missing or non-array inFlight is an empty list", async () => {
    const url = await stub(() => ({ code: 200, body: { orchestrators: [dev, { ...dev, name: "odip", inFlight: "x" }] } }));
    const snap = await getOrchestraSnapshot({ url, token: TOKEN });
    assert.deepEqual(snap.orchestrators.map((o) => o.inFlight), [[], []]);
  });
  it("a server that never answers is unreachable within 6 s", { timeout: 8000 }, async () => {
    const url = await stub(() => "hang");
    const t = Date.now();
    assert.equal((await getOrchestraSnapshot({ url, token: TOKEN })).status, "unreachable");
    assert.ok(Date.now() - t < 6000);
  });
  it("the token never appears in any result", async () => {
    const ok = await stub((_u, a) => ({ code: 200, body: { orchestrators: [], echo: a } }));
    const denied = await stub(() => ({ code: 401 }));
    for (const url of [ok, denied, "http://orchestra.invalid"]) {
      assert.ok(!JSON.stringify(await getOrchestraSnapshot({ url, token: TOKEN })).includes(TOKEN));
      assert.ok(!JSON.stringify(await getOrchestraDetail("dev", { url, token: TOKEN })).includes(TOKEN));
    }
  });
});

describe("name validation", () => {
  it("bad names make zero upstream calls; good names pass", async () => {
    const url = await stub(() => ({ code: 200, body: {} }));
    const before = requests.length;
    for (const n of ["../x", "a;b", "A", "x", "a".repeat(25)]) {
      assert.equal(ORCHESTRA_NAME.test(n), false, n);
      assert.equal((await getOrchestraDetail(n, { url, token: TOKEN })).orchestrator, null);
    }
    assert.equal(requests.length, before);
    for (const n of ["dev", "night-watch"]) assert.ok(ORCHESTRA_NAME.test(n), n);
  });
});

describe("getOrchestraDetail", () => {
  it("maps detail without leaking paths of agents, and upstream 404 is ok with null", async () => {
    const full = { ...dev, addDirs: ["F:\\y"], plugins: ["p"], checkpoint: "c", sessionId: "11111111-2222-3333-4444-555555555555", inFlight: [{ name: "a1", where: "F:\\secret", quietMin: 21 }, 5] };
    const url = await stub((u) => (u === "/v1/orchestrators/dev" ? { code: 200, body: full } : { code: 404, body: { error: "not found" } }));
    const d = await getOrchestraDetail("dev", { url, token: TOKEN });
    assert.equal(d.status, "ok");
    assert.deepEqual(d.orchestrator?.inFlight, [{ name: "a1", quietMin: 21, waiting: null }]);
    assert.equal(d.orchestrator?.checkpoint, "c");
    assert.equal(d.orchestrator?.sessionId, "11111111-2222-3333-4444-555555555555");
    const missing = await getOrchestraDetail("nope", { url, token: TOKEN });
    assert.deepEqual([missing.status, missing.orchestrator], ["ok", null]);
  });
});

describe("getOrchestraSnapshot unreadable body (hunt 7 B4)", () => {
  it("a 200 with an unreadable body is an unreadable answer, not a timeout", async () => {
    const url = await stub(() => ({ code: 200, body: "<html>not json" }));
    const snap = await getOrchestraSnapshot({ url, token: TOKEN });
    assert.equal(snap.status, "unreachable");
    assert.match(snap.detail, /sent an unreadable answer/);
  });
});
