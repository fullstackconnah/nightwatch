import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { IntegrationClient } from "./integration-client.ts";

// Node's own fetch (undici) ends a wait after 300 s of no headers or no body bytes, before our
// AbortSignal.timeout (a restore waits up to 300 s). Those rejections must read as timeouts too.

class Client extends IntegrationClient<string> {
  protected readonly displayName = "Test Service";
  protected readonly timeoutMs = 5000;
  protected readonly unconfiguredDetail = "Test Service is not configured.";
  protected credentials(): string | null {
    return "http://127.0.0.1:1";
  }
  protected baseUrl(c: string): string {
    return c;
  }
  protected authHeaders(): Record<string, string> {
    return {};
  }
  get() {
    return this.request<unknown>("/");
  }
}

const undiciError = (message: string, code: string) =>
  Object.assign(new TypeError(message), { cause: Object.assign(new Error(code), { code }) });

function stubFetch(t: TestContext, impl: () => Promise<Response>) {
  const real = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
}

const timedOutOf = (p: Awaited<ReturnType<Client["get"]>>) => (p.status === "unreachable" ? p.timedOut : undefined);

test("an undici headers timeout is flagged timedOut", async (t) => {
  stubFetch(t, () => Promise.reject(undiciError("fetch failed", "UND_ERR_HEADERS_TIMEOUT")));
  const probe = await new Client().get();
  assert.equal(probe.status, "unreachable");
  assert.equal(timedOutOf(probe), true);
});

test("an undici body timeout is flagged timedOut", async (t) => {
  const body = new ReadableStream<Uint8Array>({ start: (c) => c.error(undiciError("terminated", "UND_ERR_BODY_TIMEOUT")) });
  stubFetch(t, () => Promise.resolve(new Response(body, { status: 200 })));
  const probe = await new Client().get();
  assert.equal(probe.status, "unreachable");
  assert.equal(timedOutOf(probe), true);
});

test("a refused connection is still not timedOut", async (t) => {
  stubFetch(t, () => Promise.reject(undiciError("fetch failed", "ECONNREFUSED")));
  const probe = await new Client().get();
  assert.equal(probe.status, "unreachable");
  assert.equal(timedOutOf(probe), undefined);
});

test("a real undici headers timeout reaches the client as timedOut", async (t) => {
  // Skips, never fails, when this Node keeps its global dispatcher elsewhere.
  void Response; // loads Node's bundled undici, which sets the global dispatcher
  const Agent = (globalThis as Record<symbol, { constructor: new (o: object) => { destroy(): Promise<void> } } | undefined>)[
    Symbol.for("undici.globalDispatcher.1")
  ]?.constructor;
  if (!Agent) return t.skip("no global undici dispatcher on this Node");

  const server: Server = createServer(() => {}); // accepts, never answers
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const agent = new Agent({ headersTimeout: 200 });
  t.after(async () => {
    await agent.destroy();
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const real = globalThis.fetch;
  stubFetch(t, () => real(url, { dispatcher: agent } as RequestInit));

  const probe = await new Client().get();
  assert.equal(probe.status, "unreachable");
  assert.equal(timedOutOf(probe), true);
});
