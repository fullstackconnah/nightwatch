import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { mergeMedia } from "./settings.ts";

const NOW = "2026-11-05T00:00:00.000Z";
const TOKEN = "t".repeat(40);
const URL1 = "http://worker.example.invalid:8091";
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

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

describe("settings routes carry the media block", () => {
  it("GET /api/settings reports configured and never the token", () => {
    const src = read("../../app/api/settings/route.ts");
    assert.match(src, /media: status\(config\.media, Boolean\(config\.media\?\.workerToken\)\)/);
    const sanitize = /media: config\.media[\s\S]*?: config\.media,/.exec(src)?.[0] ?? "";
    assert.match(sanitize, /workerUrl: config\.media\.workerUrl/);
    assert.ok(!sanitize.includes("workerToken"));
  });

  it("the integrations route saves and clears media through mergeMedia", () => {
    const src = read("../../app/api/settings/integrations/route.ts");
    assert.match(src, /"media" in body/);
    assert.match(src, /mergeMedia\(/);
    assert.match(src, /delete next\.media/);
  });
});
