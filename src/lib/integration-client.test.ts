import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { IntegrationClient, type Probe } from "./integration-client.ts";

/**
 * These tests exist for one reason above all others: to pin the invariant that
 * an upstream 401 becomes `status: "unauthorized"` and NEVER an HTTP 401
 * reaching the browser. See integration-client.ts's module comment for why
 * that would log the user out of a perfectly good session.
 */

interface TestCreds {
  url: string;
  token: string;
}

class TestClient extends IntegrationClient<TestCreds> {
  protected readonly displayName = "Test Service";
  protected readonly timeoutMs = 4000;
  protected readonly unconfiguredDetail = "Test Service is not configured.";

  // A plain field, not a `private creds` parameter property: Node's
  // --experimental-strip-types runs in strip-only mode, which rejects
  // parameter properties outright (they need code generation, not just type
  // erasure). Same constraint applies to enums and namespaces in any file
  // this test runner loads.
  private readonly creds: TestCreds | null;

  constructor(creds: TestCreds | null = { url: "http://svc", token: "t" }) {
    super();
    this.creds = creds;
  }

  protected credentials(): TestCreds | null {
    return this.creds;
  }
  protected baseUrl(c: TestCreds): string {
    return c.url;
  }
  protected authHeaders(c: TestCreds): Record<string, string> {
    return { Authorization: `Bearer ${c.token}` };
  }

  // Expose the protected surface for testing.
  get<T>(path: string) {
    return this.request<T>(path);
  }
  post<T>(path: string, body?: unknown, includeErrorBody = false) {
    return this.request<T>(path, { body: body ?? {}, includeErrorBody });
  }
  postVoid(path: string) {
    return this.requestVoid(path, { body: {} });
  }
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace global fetch with one that returns `res`, or throws if it's an Error. */
function stubFetch(res: Response | Error, capture?: (url: string, init: RequestInit) => void) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capture?.(String(url), init ?? {});
    if (res instanceof Error) throw res;
    return res;
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("IntegrationClient", () => {
  it("returns ok with the parsed body on a 200", async () => {
    stubFetch(json({ entities: 3 }));
    const probe = await new TestClient().get<{ entities: number }>("/api/states");
    assert.equal(probe.status, "ok");
    assert.deepEqual(probe.status === "ok" ? probe.data : null, { entities: 3 });
  });

  it("sends auth headers and resolves the path against the base URL", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    stubFetch(json({}), (u, i) => {
      seenUrl = u;
      seenInit = i;
    });
    await new TestClient().get("/api/states");
    assert.equal(seenUrl, "http://svc/api/states");
    assert.equal((seenInit.headers as Record<string, string>).Authorization, "Bearer t");
  });

  it("reports unconfigured without touching the network", async () => {
    let called = false;
    stubFetch(json({}), () => {
      called = true;
    });
    const probe = await new TestClient(null).get("/api/states");
    assert.equal(probe.status, "unconfigured");
    assert.equal(called, false, "no request should be made when unconfigured");
  });

  it("maps a transport failure to unreachable, naming the host and timeout", async () => {
    stubFetch(new Error("ECONNREFUSED"));
    const probe = await new TestClient().get("/api/states");
    assert.equal(probe.status, "unreachable");
    assert.match(probe.detail, /Test Service at http:\/\/svc did not respond within 4s\./);
  });

  // --- the invariant ---------------------------------------------------------

  for (const code of [401, 403]) {
    it(`maps an upstream ${code} to status "unauthorized", never a thrown/forwarded ${code}`, async () => {
      stubFetch(json({ message: "bad token" }, code));
      const probe: Probe<unknown> = await new TestClient().get("/api/states");
      assert.equal(probe.status, "unauthorized");
      assert.equal(probe.httpStatus, code);
      // The whole point: the caller gets a value it must destructure, not a
      // Response it could accidentally forward with its status intact.
      assert.ok(!(probe instanceof Response));
    });
  }

  it("maps other non-OK responses to unreachable and exposes httpStatus for reclassification", async () => {
    stubFetch(json({}, 404));
    const probe = await new TestClient().get("/api/states/missing");
    assert.equal(probe.status, "unreachable");
    // HA reclassifies exactly this into its own "invalid" status.
    assert.equal(probe.httpStatus, 404);
  });

  it("maps a non-JSON 200 to unreachable for JSON callers", async () => {
    stubFetch(new Response("<html>nope</html>", { status: 200 }));
    const probe = await new TestClient().get("/api/states");
    assert.equal(probe.status, "unreachable");
    assert.match(probe.detail, /returned a non-JSON response/);
  });

  it("treats 204 as ok", async () => {
    stubFetch(new Response(null, { status: 204 }));
    const probe = await new TestClient().get("/api/services/light/toggle");
    assert.equal(probe.status, "ok");
  });

  it("includeErrorBody appends the upstream's own complaint", async () => {
    stubFetch(new Response("entity_id is required", { status: 400 }));
    const probe = await new TestClient().post("/api/services/light/toggle", {}, true);
    assert.equal(probe.status, "unreachable");
    assert.match(probe.detail, /HTTP 400: entity_id is required/);
  });

  it("requestVoid accepts a non-JSON success body", async () => {
    stubFetch(new Response("OK", { status: 200 }));
    const probe = await new TestClient().postVoid("/api/services/light/toggle");
    assert.equal(probe.status, "ok", "a plain-text 200 is success for an action endpoint");
  });

  it("requestVoid still surfaces auth failures", async () => {
    stubFetch(json({}, 401));
    const probe = await new TestClient().postVoid("/api/services/light/toggle");
    assert.equal(probe.status, "unauthorized");
  });

  it("POSTs JSON with a Content-Type when a body is given", async () => {
    let seenInit: RequestInit = {};
    stubFetch(json({}), (_u, i) => {
      seenInit = i;
    });
    await new TestClient().post("/api/services/light/toggle", { entity_id: "light.x" });
    assert.equal(seenInit.method, "POST");
    assert.equal((seenInit.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal(seenInit.body, JSON.stringify({ entity_id: "light.x" }));
  });
});
