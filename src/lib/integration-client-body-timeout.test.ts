import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { IntegrationClient } from "./integration-client.ts";
import { readJsonCapped } from "./read-capped.ts";

/** Local server on a free loopback port; closed (stalled sockets included) when the test ends. */
async function serve(t: TestContext, handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server: Server = createServer(handler);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Headers and the start of a JSON body go out at once, then the response stalls. */
const stallMidBody: Parameters<typeof createServer>[1] = (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.write('{"partial":');
};

class StallClient extends IntegrationClient<string> {
  protected readonly displayName = "Test Service";
  protected readonly timeoutMs = 300;
  protected readonly unconfiguredDetail = "Test Service is not configured.";
  private readonly base: string;

  constructor(base: string) {
    super();
    this.base = base;
  }

  protected credentials(): string | null {
    return this.base;
  }
  protected baseUrl(c: string): string {
    return c;
  }
  protected authHeaders(): Record<string, string> {
    return {};
  }

  get(path: string) {
    return this.request<unknown>(path);
  }
}

test("H41-6 step 1: an aborted body read rejects with TimeoutError", async (t) => {
  const base = await serve(t, stallMidBody);
  const res = await fetch(base, { signal: AbortSignal.timeout(200) });
  await assert.rejects(readJsonCapped(res, 1024), (e: Error) => {
    assert.equal(e.name, "TimeoutError");
    return true;
  });
});

test("H41-6: a timeout while the body is read is flagged timedOut", async (t) => {
  const probe = await new StallClient(await serve(t, stallMidBody)).get("/");
  assert.equal(probe.status, "unreachable");
  assert.equal(probe.status === "unreachable" ? probe.timedOut : undefined, true);
  assert.match(probe.status === "unreachable" ? probe.detail : "", /did not respond within 0\.3s\./);
});

test("H41-6: a non-JSON body is still 'non-JSON' and not timedOut", async (t) => {
  const base = await serve(t, (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("not json");
  });
  const probe = await new StallClient(base).get("/");
  assert.equal(probe.status, "unreachable");
  assert.match(probe.status === "unreachable" ? probe.detail : "", /returned a non-JSON response\./);
  assert.equal(probe.status === "unreachable" ? probe.timedOut : undefined, undefined);
});
