import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig, saveConfig } from "../config.ts";
import { mediaPublic, mergeMedia } from "./settings.ts";

const NOW = "2026-11-05T00:00:00.000Z";
const TOKEN = "t".repeat(40);
const URL1 = "http://worker.example.invalid:8091";

describe("mergeMedia", () => {
  it("saving a URL and a token writes both", () => {
    assert.deepEqual(mergeMedia({ workerUrl: URL1, workerToken: TOKEN }, undefined, NOW), {
      media: { workerUrl: URL1, workerToken: TOKEN, updatedAt: NOW },
    });
  });

  it("a second save without a token keeps the old one; an empty token too", () => {
    const current = { workerUrl: URL1, workerToken: TOKEN, updatedAt: "old" };
    assert.equal((mergeMedia({ workerUrl: "http://other.example.invalid:8091" }, current, NOW) as any).media.workerToken, TOKEN);
    assert.equal((mergeMedia({ workerUrl: URL1, workerToken: "  " }, current, NOW) as any).media.workerToken, TOKEN);
  });

  it("refuses a save with no URL or no token", () => {
    assert.deepEqual(mergeMedia({ workerToken: TOKEN }, undefined, NOW), { error: "Media needs the worker URL" });
    assert.deepEqual(mergeMedia({ workerUrl: URL1 }, undefined, NOW), { error: "Media needs the worker token" });
  });
});

describe("the media block through the saved config", () => {
  it("saves, reads back without the token, and clears", () => {
    const prev = process.env.DATA_DIR;
    const dir = mkdtempSync(join(tmpdir(), "nw-media-"));
    process.env.DATA_DIR = dir;
    try {
      const merged = mergeMedia({ workerUrl: "http://media-worker:8091", workerToken: "tok-xyz" }, undefined, NOW);
      assert.ok("media" in merged);
      saveConfig({ ...loadConfig(), media: merged.media });
      const body = { config: { media: mediaPublic(loadConfig().media) }, media: { configured: Boolean(loadConfig().media?.workerToken) } };
      assert.equal(body.media.configured, true);
      assert.equal(body.config.media?.workerUrl, "http://media-worker:8091");
      assert.ok(!JSON.stringify(body).includes("tok-xyz"));
      const { media: _gone, ...rest } = loadConfig();
      saveConfig(rest);
      assert.equal(mediaPublic(loadConfig().media), undefined);
    } finally {
      if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
