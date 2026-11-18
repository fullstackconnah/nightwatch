import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as report from "./attention-report.ts";

const SENTENCE = "The saved settings can't be read, so the dashboard is running on defaults. Open Settings for details.";

describe("settingsHit: the `settings` probe", () => {
  it("reports one bad hit with the agreed text when the config has a problem", () => {
    for (const problem of ["blank", "unreadable", "unreadable-no-copy"]) {
      const hits = report.settingsHit(problem);
      assert.equal(hits.length, 1);
      assert.equal(hits[0].subject, "settings");
      assert.equal(hits[0].severity, "bad");
      assert.equal(hits[0].detail, SENTENCE);
      assert.ok(hits[0].headline.length <= 48);
      assert.ok(!/config\.json|data\//.test(JSON.stringify(hits[0])), "no file path");
    }
  });
  it("passes (no hits) when the config reads fine", () => {
    assert.deepEqual(report.settingsHit(null), []);
  });
  it("links to the Settings page", () => {
    assert.deepEqual(report.ownerFor("settings", "settings"), { href: "/settings", label: "Open Settings" });
  });
  it("never reaches the family wall (kiosk), only Home", () => {
    const [h] = report.toHits(
      [{ status: { id: "settings", label: "Saved settings", state: "answered", hits: 1 }, hits: report.settingsHit("blank") }],
      () => "2026-11-18T00:00:00Z",
    );
    assert.deepEqual(report.firstHit([h]), { status: "quiet" });
  });
  it("attention.ts runs it first, labelled `Saved settings`, from configProblem()", () => {
    const src = readFileSync(new URL("./attention.ts", import.meta.url), "utf8");
    const defs = src.slice(src.indexOf("const defs: ProbeDef[] = ["));
    assert.match(defs, /^const defs: ProbeDef\[\] = \[\s*\{ id: "settings", label: "Saved settings", run: \(\) => settingsHit\(configProblem\(\)\) \},/);
  });
});
