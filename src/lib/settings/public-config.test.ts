import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  minecraft: { managerUrl: "http://mc.test", managerToken: "", rconHost: "h", rconPassword: "", rconPort: 1, curseforgeKey: "" },
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

  it("FULL covers every secret-named field AppConfig declares", () => {
    const src = readFileSync(new URL("../config.ts", import.meta.url), "utf8");
    const start = src.indexOf("export interface AppConfig {");
    const body = src.slice(start, src.indexOf("\n}", start));
    const NOT_SECRET = new Set(["pinnedFolders"]);
    const declared = new Set([...body.matchAll(/(\w+)\??:/g)].map((m) => m[1]).filter((k) => SECRET.test(k) && !NOT_SECRET.has(k)));
    const seeded = JSON.stringify(FULL);
    for (const k of declared) assert.ok(seeded.includes(`"${k}"`), `${k} is declared in AppConfig but not seeded in FULL`);
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
