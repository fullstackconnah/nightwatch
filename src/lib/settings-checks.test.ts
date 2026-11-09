import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  applyPin, budgetChangeError, budgetError, discordChannelIdError, discordUserIdsError, httpUrlError, modelNameError, mcpTokenError, rconHostError, rconPortError, webhookError,
} from "./settings-checks.ts";

describe("settings checks", () => {
  it("mcp token: short typed fails, blank and 24+ pass", () => {
    assert.equal(mcpTokenError("abc"), "MCP token must be at least 24 characters");
    assert.equal(mcpTokenError("a".repeat(23)) !== null, true);
    assert.equal(mcpTokenError("a".repeat(24)), null);
    assert.equal(mcpTokenError(undefined), null);
    assert.equal(mcpTokenError(""), null);
  });
  it("http url: typed bad fails naming the field, blank passes", () => {
    assert.equal(httpUrlError("hermesApiUrl", ""), null);
    assert.equal(httpUrlError("hermesApiUrl", undefined), null);
    assert.equal(httpUrlError("hermesApiUrl", "http://example.test:1"), null);
    assert.equal(httpUrlError("oidcIssuer", "https://example.test"), null);
    assert.equal(httpUrlError("oidcIssuer", "ftp://example.test"), "SSO issuer must be an http(s) URL");
    for (const f of ["managerUrl", "hermesApiUrl", "voiceServerUrl", "voiceTtsUrl", "oidcIssuer", "orchestraUrl"]) {
      assert.doesNotMatch(httpUrlError(f, "nope") ?? "", /[a-z][A-Z]/, f);
    }
    assert.equal(httpUrlError("voiceTtsUrl", "javascript:alert(1)") !== null, true);
    assert.equal(httpUrlError("voiceServerUrl", "abc") !== null, true);
  });
  it("rcon port: integer 1-65535 only; absent keeps", () => {
    assert.equal(rconPortError(undefined), null);
    assert.equal(rconPortError(25575), null);
    for (const bad of [0, 65536, -1, 1.5, "25575", null, NaN]) assert.notEqual(rconPortError(bad), null, String(bad));
  });
  it("rcon host: at most 253", () => {
    assert.equal(rconHostError("a".repeat(253)), null);
    assert.notEqual(rconHostError("a".repeat(254)), null);
    assert.equal(rconHostError(undefined), null);
  });
  it("budget: 0..1000", () => {
    assert.equal(budgetError(1000), null);
    assert.equal(budgetError(0), null);
    assert.notEqual(budgetError(1000.01), null);
    assert.notEqual(budgetError(-1), null);
    assert.notEqual(budgetError("5"), null);
  });
  it("budget cap applies only to a changed value", () => {
    assert.equal(budgetChangeError(2000, 2000), null); // stored over the cap before the cap existed
    assert.notEqual(budgetChangeError(2000, 5), null);
    assert.equal(budgetChangeError(1000, 5), null);
    assert.notEqual(budgetChangeError(-1, -1), null);
    assert.notEqual(budgetChangeError("", 5), null);
    assert.notEqual(budgetChangeError(null, 5), null);
  });
  it("webhook: https only, blank passes", () => {
    assert.equal(webhookError(undefined), null);
    assert.equal(webhookError("https://example.test/hook"), null);
    assert.notEqual(webhookError("http://example.test/hook"), null);
    assert.notEqual(webhookError("abc"), null);
  });
  describe("pins", () => {
    const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
    it("pin adds once; stored trailing-slash twin counts as present", () => {
      assert.deepEqual(applyPin(["/a"], "pin", "/b", norm), { pins: ["/a", "/b"] });
      assert.deepEqual(applyPin(["/a/"], "pin", "/a", norm), { pins: ["/a/"] });
    });
    it("unpin removes a stored pin that normalises to the same path", () => {
      assert.deepEqual(applyPin(["/a/", "/b"], "unpin", "/a", norm), { pins: ["/b"] });
    });
    it("the pin cap counts distinct normalised pins", () => {
      const stored = ["/a", "/a/", ...Array.from({ length: 48 }, (_, i) => `/p${i}`)];
      assert.deepEqual(applyPin(stored, "pin", "/new", norm), { pins: [...stored, "/new"] });
    });
    it("a 51st pin is refused, re-pinning at 50 is not", () => {
      const fifty = Array.from({ length: 50 }, (_, i) => `/p${i}`);
      assert.deepEqual(applyPin(fifty, "pin", "/new", norm), { error: "At most 50 pins" });
      assert.deepEqual(applyPin(fifty, "pin", "/p3", norm), { pins: fifty });
    });
  });
});

describe("hunt 27 input checks", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("discord channel id: blank or 17-20 digits", () => {
    for (const ok of ["", undefined, "123456789012345678", "1".repeat(20)]) assert.equal(discordChannelIdError(ok), null, String(ok));
    for (const bad of ["12345", "1234567890123456789a", "1".repeat(21)]) {
      assert.equal(discordChannelIdError(bad), "Channel ID must be a Discord ID: 17 to 20 digits.", bad);
    }
  });
  it("allowed user ids: every entry 17-20 digits", () => {
    assert.equal(discordUserIdsError(["123456789012345678", "1".repeat(20)]), null);
    assert.equal(discordUserIdsError([]), null);
    assert.equal(discordUserIdsError(["123456789012345678", "12345"]), "Each allowed user ID must be a Discord ID: 17 to 20 digits.");
  });
  it("model name: blank or a plain name, no flag, space, = or newline", () => {
    for (const ok of ["", undefined, "claude-sonnet-5-5", "anthropic/claude-opus-5-5", "qwen3:8b"]) {
      assert.equal(modelNameError("Model", ok), null, String(ok));
    }
    for (const bad of ["-oProxyCommand", "model\nX=1", "a b", "a=b", "a".repeat(101)]) {
      assert.equal(modelNameError("Hard-ticket model", bad), "Hard-ticket model must be a model name, such as claude-sonnet-5-5.", JSON.stringify(bad));
    }
  });
  it("base urls: no login, query or fragment; trailing slash and a path are fine", () => {
    for (const bad of ["http://h:8080/?x=1", "http://h/#a", "http://u:p@h/"]) {
      assert.equal(httpUrlError("Forgejo URL", bad), "Forgejo URL must be a plain http(s) address, with no login, ?query or #fragment.", bad);
    }
    assert.equal(httpUrlError("x", "http://h:8080/"), null);
    assert.equal(httpUrlError("x", "https://h/sub"), null);
  });
  it("hermes-daemon route runs the checks before the strict read and the write", () => {
    const src = read("../app/api/settings/hermes-daemon/route.ts");
    const read1 = src.indexOf("readHermesSettingsFileForSave(");
    const write = src.indexOf("writeHermesSettingsFile(next)");
    for (const fn of ["discordChannelIdError(", "discordUserIdsError(", "modelNameError("]) {
      const at = src.indexOf(fn);
      assert.ok(at > 0 && at < read1 && read1 < write, fn);
    }
  });
  it("oidc discovery and token POST use the no-cross-origin fetch", () => {
    const src = read("./oidc.ts");
    assert.doesNotMatch(src, /(?<![.\w])fetch\(/);
    assert.equal((src.match(/fetchNoCrossOriginRedirect\(/g) ?? []).length, 2);
  });
});
