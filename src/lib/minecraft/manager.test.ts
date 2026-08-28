import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { McManagerClient, mcManagerCredentials, probeHttpStatus, type McInstance } from "./manager.ts";
import type { ProbeFail } from "../integration-client.ts";

/**
 * McManagerClient is a thin IntegrationClient subclass — the invariant it
 * inherits (401 -> "unauthorized", never a forwarded 401) is already pinned
 * by integration-client.test.ts. These tests cover what's specific to this
 * subclass: credentials resolution and the request shape sent to mc-manager.
 */

interface TestCreds {
  url: string;
  token: string;
}

/** Subclass overriding `credentials()` directly, same approach as
 *  integration-client.test.ts's TestClient — avoids going through
 *  loadConfig()/DATA_DIR for these tests. */
class TestableManagerClient extends McManagerClient {
  private readonly creds: TestCreds | null;

  constructor(creds: TestCreds | null = { url: "http://mc-manager:8080", token: "sekret" }) {
    super();
    this.creds = creds;
  }

  protected credentials(): TestCreds | null {
    return this.creds;
  }
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(res: Response | Error, capture?: (url: string, init: RequestInit) => void) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capture?.(String(url), init ?? {});
    if (res instanceof Error) throw res;
    return res;
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("McManagerClient", () => {
  it("reports unconfigured without touching the network", async () => {
    let called = false;
    stubFetch(json({}), () => {
      called = true;
    });
    const probe = await new TestableManagerClient(null).instances();
    assert.equal(probe.status, "unconfigured");
    assert.equal(called, false, "no request should be made when unconfigured");
  });

  it("maps an upstream 401 to status \"unauthorized\"", async () => {
    stubFetch(json({ message: "bad token" }, 401));
    const probe = await new TestableManagerClient().instances();
    assert.equal(probe.status, "unauthorized");
  });

  it("instances() hits GET <url>/instances with a bearer auth header and returns the data", async () => {
    const instances: McInstance[] = [
      {
        slug: "atm10",
        name: "All The Mods 10",
        source: "curseforge",
        packRef: "https://www.curseforge.com/minecraft/modpacks/all-the-mods-10",
        mcVersion: "1.21.1",
        memoryGb: 6,
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    ];
    let seenUrl = "";
    let seenInit: RequestInit = {};
    stubFetch(json({ instances, active: "atm10" }), (u, i) => {
      seenUrl = u;
      seenInit = i;
    });

    const probe = await new TestableManagerClient().instances();

    assert.equal(seenUrl, "http://mc-manager:8080/instances");
    assert.equal((seenInit.headers as Record<string, string>).Authorization, "Bearer sekret");
    assert.equal(probe.status, "ok");
    assert.deepEqual(probe.status === "ok" ? probe.data : null, { instances, active: "atm10" });
  });
});

describe("mcManagerCredentials", () => {
  it("trims whitespace and strips trailing slashes from the url", () => {
    const creds = mcManagerCredentials({ managerUrl: " http://x:8090// ", managerToken: " t " });
    assert.deepEqual(creds, { url: "http://x:8090", token: "t" });
  });

  it("returns null when the token is missing", () => {
    const creds = mcManagerCredentials({ managerUrl: "http://x:8090" });
    assert.equal(creds, null);
  });

  it("returns null when the url is missing", () => {
    const creds = mcManagerCredentials({ managerToken: "t" });
    assert.equal(creds, null);
  });

  it("returns null for an undefined block", () => {
    assert.equal(mcManagerCredentials(undefined), null);
  });
});

describe("probeHttpStatus", () => {
  it("maps unconfigured to 409", () => {
    assert.equal(probeHttpStatus({ status: "unconfigured", detail: "" } satisfies ProbeFail), 409);
  });

  it("maps unreachable to 502", () => {
    assert.equal(probeHttpStatus({ status: "unreachable", detail: "" } satisfies ProbeFail), 502);
  });

  it("maps unauthorized to 502", () => {
    assert.equal(probeHttpStatus({ status: "unauthorized", detail: "" } satisfies ProbeFail), 502);
  });
});
