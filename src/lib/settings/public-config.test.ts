import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "../config.ts";
import { mergeDashPut } from "./dash-put.ts";
import { sanitizeConfig } from "./public-config.ts";

const SECRET = /key|token|password|secret|pin|hash/i;

/** Fills every secret-named string field of every top-level block with a unique fake value. */
function withFakeSecrets(cfg: Record<string, unknown>): { cfg: AppConfig; fakes: string[] } {
  const fakes: string[] = [];
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          if (typeof x === "string" || x === undefined) {
            if (!SECRET.test(k)) return [k, x];
            const fake = `FAKE-SECRET-${k}-${fakes.length}`;
            fakes.push(fake);
            return [k, fake];
          }
          return [k, walk(x)];
        }),
      );
    }
    return v;
  };
  return { cfg: walk(cfg) as AppConfig, fakes };
}

// Every secret-bearing field of every AppConfig block, seeded with a placeholder the walker replaces.
const FULL = {
  groups: [], urls: {}, icons: {}, hidden: [],
  widgets: [{ id: "w1", type: "generic", container: "c", url: "http://x.test", key: "", password: "" }],
  jellyfin: { url: "http://jf.test", key: "", kioskUser: "u" },
  homeassistant: { url: "http://ha.test", token: "" },
  npm: { url: "http://npm.test", email: "a@b.test", password: "" },
  forgejo: { url: "http://fg.test", token: "" },
  github: { token: "" },
  minecraft: { managerUrl: "http://mc.test", managerToken: "", rconHost: "h", rconPassword: "", rconPort: 1 },
  media: { workerUrl: "http://m.test", workerToken: "" },
  hermes: { tier: "local", model: "m", openrouterApiKey: "", anthropicApiKey: "" },
  system: {
    mcpToken: "", kioskPin: "", hermesApiUrl: "http://h.test", hermesApiToken: "", orchestraUrl: "http://o.test",
    orchestraToken: "", oidcIssuer: "http://i.test", oidcClientId: "id", oidcClientSecret: "", adminPasswordHash: "",
  },
};

describe("sanitizeConfig", () => {
  it("leaks no secret from any config block", () => {
    const { cfg, fakes } = withFakeSecrets(FULL);
    assert.ok(fakes.length >= 12);
    const out = JSON.stringify(sanitizeConfig(cfg));
    for (const f of fakes) assert.ok(!out.includes(f), `leaked ${f}`);
  });

  it("keeps the non-secret jellyfin fields", () => {
    const out = sanitizeConfig({ ...FULL, jellyfin: { url: "http://jf.test", key: "test-jf-key", kioskUser: "u" } } as AppConfig);
    assert.deepEqual(out.jellyfin, { url: "http://jf.test", kioskUser: "u" });
  });
});

describe("mergeDashPut and the Jellyfin key", () => {
  it("a PUT body with jellyfin but no key keeps the stored key", () => {
    const stored = { ...FULL, jellyfin: { url: "http://jf.test", key: "test-jf-key" } } as AppConfig;
    const r = mergeDashPut(stored, { hidden: ["a"], jellyfin: { url: "http://other.test" } });
    assert.ok("next" in r);
    assert.deepEqual(r.next.jellyfin, { url: "http://jf.test", key: "test-jf-key" });
  });
});
