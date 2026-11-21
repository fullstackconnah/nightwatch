import test from "node:test";
import assert from "node:assert/strict";
import { packProviderNote, packSearchView } from "./minecraft-pack-notes.ts";

test("packProviderNote names the failed provider", () => {
  assert.equal(packProviderNote({ modrinth: "error", curseforge: "error" }), "Modrinth and CurseForge didn't answer. Try again.");
  assert.equal(packProviderNote({ modrinth: "error", curseforge: "ok" }), "Modrinth didn't answer. Try again.");
  assert.equal(packProviderNote({ modrinth: "ok", curseforge: "error" }), "CurseForge didn't answer. Try again.");
  assert.equal(packProviderNote({ modrinth: "ok", curseforge: "ok" }), null);
  assert.equal(packProviderNote({ modrinth: "ok", curseforge: "no-key" }), null);
  assert.equal(packProviderNote(undefined), null);
  assert.equal(packProviderNote({ curseforge: "no-key", modrinth: "error" }), "Modrinth didn't answer. Try again.");
});

test("packSearchView picks one state", () => {
  const ok = { results: [{}], modrinth: "ok", curseforge: "ok" };
  const none = { results: [], modrinth: "ok", curseforge: "ok" };
  const down = { results: [], modrinth: "error", curseforge: "ok" };
  assert.equal(packSearchView("", false, undefined, false), "prompt");
  assert.equal(packSearchView("x", true, ok, false), "failed");
  assert.equal(packSearchView("x", false, undefined, true), "searching");
  assert.equal(packSearchView("x", false, ok, true), "searching-over-old");
  assert.equal(packSearchView("x", false, down, true), "searching-over-old");
  assert.equal(packSearchView("x", false, none, false), "empty");
  assert.equal(packSearchView("x", false, down, false), "empty-with-note");
  assert.equal(packSearchView("x", false, ok, false), "results");
});
