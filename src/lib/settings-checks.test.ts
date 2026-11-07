import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPin, budgetChangeError, budgetError, httpUrlError, mcpTokenError, rconHostError, rconPortError, webhookError,
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
    assert.equal(httpUrlError("oidcIssuer", "ftp://example.test"), "oidcIssuer must be an http(s) URL");
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
