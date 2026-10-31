import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { mergeOrchestraSettings, publicSystem } from "./orchestra-settings.ts";
import { resetLastOk, trackLastOk } from "./orchestra-view.ts";
import type { OrchestraSnapshot } from "./types/orchestra.ts";

const SENTINEL = "tok-SENTINEL-do-not-leak";

describe("mergeOrchestraSettings", () => {
  const existing = { orchestraUrl: "http://192.0.2.10:7420", orchestraToken: "old-token" };

  it("keeps url and token when the body omits them", () => {
    assert.deepEqual(mergeOrchestraSettings({}, existing), existing);
  });

  it("sets them when given, and an empty token keeps the stored one", () => {
    assert.deepEqual(
      mergeOrchestraSettings({ orchestraUrl: " http://192.0.2.11:7420 ", orchestraToken: "new" }, existing),
      { orchestraUrl: "http://192.0.2.11:7420", orchestraToken: "new" },
    );
    assert.equal((mergeOrchestraSettings({ orchestraToken: "" }, existing) as { orchestraToken: string }).orchestraToken, "old-token");
  });

  it("an explicit empty url clears it (falls back to the env var)", () => {
    assert.equal((mergeOrchestraSettings({ orchestraUrl: "" }, existing) as { orchestraUrl: string }).orchestraUrl, "");
  });

  it("rejects a url that is not http(s)", () => {
    for (const bad of ["ftp://x:1", "192.0.2.10:7420", "not a url", "javascript:alert(1)"]) {
      assert.deepEqual(mergeOrchestraSettings({ orchestraUrl: bad }, existing), { error: "orchestraUrl must be an http(s) URL" });
    }
  });
});

describe("publicSystem (what GET /api/settings returns)", () => {
  it("returns orchestraUrl but never any secret, whatever the stored block holds", () => {
    const out = publicSystem({
      orchestraUrl: "http://192.0.2.10:7420",
      orchestraToken: SENTINEL,
      mcpToken: SENTINEL,
      kioskPin: SENTINEL,
      hermesApiToken: SENTINEL,
      oidcClientSecret: SENTINEL,
      adminPasswordHash: SENTINEL,
    });
    assert.equal(out?.orchestraUrl, "http://192.0.2.10:7420");
    assert.equal(JSON.stringify(out).includes(SENTINEL), false);
  });
});

describe("system route wiring (source-level)", () => {
  const src = readFileSync(new URL("../app/api/settings/system/route.ts", import.meta.url), "utf8");
  it("carries orchestraUrl and orchestraToken into the saved system block", () => {
    const block = /system: \{[\s\S]*?updatedAt: now,/.exec(src)?.[0] ?? "";
    assert.match(block, /orchestraUrl/);
    assert.match(block, /orchestraToken/);
  });
});

describe("settings GET wiring (source-level)", () => {
  const src = readFileSync(new URL("../app/api/settings/route.ts", import.meta.url), "utf8");
  it("sanitizes through publicSystem and reports orchestraConfigured, never the token", () => {
    assert.match(src, /publicSystem\(config\.system\)/);
    assert.match(src, /orchestraConfigured/);
    assert.equal(/orchestraToken/.test(src.replace(/systemSetting\("orchestraToken", "ORCHESTRA_TOKEN"\)/g, "").replace(/orchestraTokenSet/g, "")), false);
  });

  it("reports orchestraTokenSet from the token alone (URL empty), as a boolean only", () => {
    assert.ok(src.includes('orchestraTokenSet: Boolean(systemSetting("orchestraToken", "ORCHESTRA_TOKEN"))'));
  });
});

describe("last-known snapshot", () => {
  const snap = (name: string) => ({ status: "ok", orchestrators: [{ name }] }) as unknown as OrchestraSnapshot;
  it("keeps the last ok snapshot until a settings save resets it", () => {
    resetLastOk();
    assert.equal(trackLastOk(snap("old")), trackLastOk(undefined));
    assert.equal(trackLastOk({ status: "unreachable" } as unknown as OrchestraSnapshot)?.orchestrators[0]?.name, "old");
    resetLastOk();
    assert.equal(trackLastOk({ status: "unreachable" } as unknown as OrchestraSnapshot), null);
  });
});
