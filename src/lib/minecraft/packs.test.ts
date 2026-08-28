import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCurseforge, normalizeModrinth } from "./packs.ts";

describe("normalizeCurseforge", () => {
  it("maps the documented shape", () => {
    const out = normalizeCurseforge({
      data: [{
        id: 925200, slug: "all-the-mods-10", name: "All The Mods 10",
        summary: "ATM10", downloadCount: 1000000,
        logo: { url: "https://cdn/logo.png" },
        links: { websiteUrl: "https://www.curseforge.com/minecraft/modpacks/all-the-mods-10" },
        latestFilesIndexes: [{ gameVersion: "1.21.1", modLoader: 6 }],
      }],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].source, "curseforge");
    assert.equal(out[0].loader, "neoforge");
    assert.equal(out[0].mcVersion, "1.21.1");
    assert.equal(out[0].pageUrl, "https://www.curseforge.com/minecraft/modpacks/all-the-mods-10");
  });
  it("tolerates junk", () => {
    assert.deepEqual(normalizeCurseforge(null), []);
    assert.deepEqual(normalizeCurseforge({ data: [{}] }), []);
  });
  it("drops malformed entries but keeps valid ones alongside them", () => {
    const out = normalizeCurseforge({
      data: [
        {},
        {
          id: 925200, slug: "all-the-mods-10", name: "All The Mods 10",
          summary: "ATM10", downloadCount: 1000000,
          logo: { url: "https://cdn/logo.png" },
          links: { websiteUrl: "https://www.curseforge.com/minecraft/modpacks/all-the-mods-10" },
          latestFilesIndexes: [{ gameVersion: "1.21.1", modLoader: 6 }],
        },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "925200");
    assert.equal(out[0].slug, "all-the-mods-10");
  });
});

describe("normalizeModrinth", () => {
  it("maps the documented shape", () => {
    const out = normalizeModrinth({
      hits: [{
        project_id: "abc", slug: "cobblemon-official", title: "Cobblemon",
        description: "Pokemon", icon_url: "https://cdn/i.png", downloads: 5,
        versions: ["1.20.1", "1.21.1"], categories: ["adventure", "fabric"],
      }],
    });
    assert.equal(out[0].loader, "fabric");
    assert.equal(out[0].mcVersion, "1.21.1");
    assert.equal(out[0].pageUrl, "https://modrinth.com/modpack/cobblemon-official");
  });
  it("tolerates junk", () => {
    assert.deepEqual(normalizeModrinth(undefined), []);
  });
});
