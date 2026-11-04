import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createMock } from "../../scripts/fixtures/orchestra-mock.mjs";
import { getOrchestraDetail, getOrchestraSnapshot } from "./orchestra.ts";

let server: Server;
let url: string;
before(async () => {
  server = createMock({ slowMs: 30 });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const creds = (token: string) => ({ url, token });

describe("orchestra mock speaks the shape src/lib/orchestra.ts reads", () => {
  it("mock-mixed: four orchestrators covering every run state", async () => {
    const s = await getOrchestraSnapshot(creds("mock-mixed"));
    assert.equal(s.status, "ok");
    assert.deepEqual(s.orchestrators.map((o) => o.state), ["running", "stopped", "stalled", "unknown"]);
    assert.equal(s.orchestrators[2].stalledCount, 1);
    assert.equal(s.orchestrators[0].title?.length, 70);
    assert.equal(s.orchestrators[3].home?.length, 60);
  });

  it("mock-mixed detail: odip has a 300-char checkpoint and a stalled agent; the unknown one is 404", async () => {
    const d = await getOrchestraDetail("odip", creds("mock-mixed"));
    assert.equal(d.orchestrator?.checkpoint?.length, 300);
    assert.deepEqual(d.orchestrator?.inFlight.map((e) => [e.name, e.quietMin]), [["odip-builder", 25], ["odip-fixer", 3], ["odip-review", null]]);
    const gone = await getOrchestraDetail("night-watch-orchestr", creds("mock-mixed"));
    assert.equal(gone.status, "ok");
    assert.equal(gone.orchestrator, null);
  });

  it("every list item carries inFlight with waiting, and never a path", async () => {
    const s = await getOrchestraSnapshot(creds("mock-mixed"));
    assert.deepEqual(s.orchestrators.map((o) => o.inFlight.length), [2, 0, 3, 0]);
    assert.ok(s.orchestrators.every((o) => o.inFlight.every((a) => a.waiting === null)));
    assert.ok(!JSON.stringify(s).includes("jsonl"));
  });

  it("mock-stuck: one waiting 7 m, a stalled 24 m, a quiet 19 m and a 26-character name", async () => {
    const s = await getOrchestraSnapshot(creds("mock-stuck"));
    const agents = s.orchestrators.flatMap((o) => o.inFlight);
    assert.deepEqual(agents.find((a) => a.waiting)?.waiting, { tool: "Bash", sinceMin: 7 });
    assert.deepEqual(agents.filter((a) => a.quietMin === 24 || a.quietMin === 19).length, 2);
    assert.ok(agents.some((a) => a.name.length === 26));
    const d = await getOrchestraDetail("design", creds("mock-stuck"));
    assert.equal(d.orchestrator?.inFlight[0].waiting?.sinceMin, 7);
  });

  it("mock-busy: one lane has six agents in flight", async () => {
    const s = await getOrchestraSnapshot(creds("mock-busy"));
    assert.equal(s.orchestrators[0].inFlight.length, 6);
  });

  it("mock-empty: ok with no orchestrators", async () => {
    const s = await getOrchestraSnapshot(creds("mock-empty"));
    assert.deepEqual([s.status, s.orchestrators.length], ["ok", 0]);
  });

  it("mock-slow: still answers mixed data after its delay", async () => {
    const s = await getOrchestraSnapshot(creds("mock-slow"));
    assert.equal(s.orchestrators.length, 4);
  });

  it("any other token is unauthorized", async () => {
    assert.equal((await getOrchestraSnapshot(creds("wrong"))).status, "unauthorized");
  });
});
