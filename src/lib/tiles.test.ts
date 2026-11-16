import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ContainerSummary } from "./docker.ts";
import { buildTiles } from "./tiles.ts";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "nw-tiles-")); // empty: default config, never data/config.json

const container: ContainerSummary = {
  id: "abc",
  name: "jellyfin",
  image: "jellyfin/jellyfin",
  state: "running",
  status: "Up 1 hour",
  health: null,
  composeProject: "media",
  composeService: "jellyfin",
  ports: [],
  labels: {
    "secret.example": "VALUE",
    "dashboard.url": "http://example.test:8096",
    "dashboard.icon": "https://example.test/i.png",
    "dashboard.group": "Media",
    "dashboard.enable": "false",
  },
  created: 0,
};

describe("buildTiles", () => {
  it("returns no Docker labels to the browser, and still reads the dashboard ones", () => {
    const [t] = buildTiles([container], new Set());
    assert.equal("labels" in t, false);
    assert.equal(JSON.stringify(t).includes("VALUE"), false);
    assert.deepEqual(t.tile, {
      url: "http://example.test:8096",
      icon: "https://example.test/i.png",
      group: "Media",
      hidden: true,
      hasWidget: false,
    });
  });
});
