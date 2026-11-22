import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFirstSeen, saveFirstSeen } from "./attention-first-seen-store.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nw-first-seen-"));
const T = "2026-11-20T10:00:00.000Z";

describe("attention first-seen store", () => {
  it("round trips", () => {
    const f = path.join(tmp(), "fs.json");
    const m = new Map([["a:1", T], ["b:2", "2026-11-21T01:02:03.000Z"]]);
    saveFirstSeen(m, f);
    assert.deepEqual([...loadFirstSeen(f)], [...m]);
  });

  it("missing, non-JSON, array and oversize files load empty", () => {
    const d = tmp();
    assert.equal(loadFirstSeen(path.join(d, "none.json")).size, 0);
    const cases: Record<string, string> = {
      text: "not json {",
      array: JSON.stringify([T]),
      big: JSON.stringify({ a: T, pad: "x".repeat(70 * 1024) }),
    };
    for (const [name, body] of Object.entries(cases)) {
      const f = path.join(d, name + ".json");
      fs.writeFileSync(f, body);
      assert.equal(loadFirstSeen(f).size, 0, name);
    }
  });

  it("drops bad entries and keeps a valid neighbour", () => {
    const f = path.join(tmp(), "fs.json");
    fs.writeFileSync(f, JSON.stringify({
      ok: T, num: 5, bad: "yesterday-ish", future: new Date(Date.now() + 3600_000).toISOString(),
      "": T, ["k".repeat(201)]: T,
    }));
    assert.deepEqual([...loadFirstSeen(f)], [["ok", T]]);
  });

  it("keeps at most 500 entries", () => {
    const f = path.join(tmp(), "fs.json");
    const o: Record<string, string> = {};
    for (let i = 0; i < 600; i++) o["id" + i] = T;
    fs.writeFileSync(f, JSON.stringify(o));
    assert.equal(loadFirstSeen(f).size, 500);
  });

  it("save into an unwritable path does not throw", () => {
    const d = tmp();
    const blocker = path.join(d, "file");
    fs.writeFileSync(blocker, "x");
    assert.doesNotThrow(() => saveFirstSeen(new Map([["a", T]]), path.join(blocker, "sub", "fs.json")));
  });

  it("attention.ts loads and saves it", () => {
    const src = fs.readFileSync(new URL("./attention.ts", import.meta.url), "utf8");
    assert.ok(src.includes("loadFirstSeen("));
    assert.ok(src.includes("saveFirstSeen("));
    assert.ok(!src.includes("resets on restart, fine while the process is long-lived"));
  });
});
