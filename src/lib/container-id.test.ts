import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { clampLogsTail, containerActionUrl, isContainerId, isImageId } from "./container-id.ts";

/* No docker route test exists and node tests cannot import "@/" modules, so the routes and disk-scan are checked by source scan. */
const SRC = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("isImageId", () => {
  it("accepts the list route's sha256 id and short hex ids", () => {
    assert.ok(isImageId("sha256:" + "a1b2c3d4".repeat(8)));
    assert.ok(isImageId("0123456789ab"));
    assert.ok(isImageId("a".repeat(64)));
  });
  for (const bad of ["../containers/x", "a/../b", "x?force=1", "", "%2e%2e", "sha256:abc", "nginx:latest", "sha256:" + "g".repeat(64)]) {
    it(`rejects ${JSON.stringify(bad)}`, () => assert.equal(isImageId(bad), false));
  }
});

describe("containerActionUrl", () => {
  it("containerActionUrl keeps a long name whole", () => {
    assert.equal(containerActionUrl("homeassistant-companion"), "/api/docker/containers/homeassistant-companion/action");
  });
  it("containerActionUrl keeps a 64-hex id whole", () => {
    const id = "a1b2c3d4".repeat(8);
    assert.equal(containerActionUrl(id), `/api/docker/containers/${id}/action`);
  });
});

describe("docker route id guards", () => {
  it("rejects a traversal container id", () => assert.equal(isContainerId("..%2Fx"), false));
  const routes: [string, string, string][] = [
    ["app/api/docker/containers/[id]/route.ts", "isContainerId", "invalid container id"],
    ["app/api/docker/containers/[id]/stats/route.ts", "isContainerId", "invalid container id"],
    ["app/api/docker/containers/[id]/logs/route.ts", "isContainerId", "invalid container id"],
    ["app/api/docker/images/[id]/route.ts", "isImageId", "invalid image id"],
  ];
  for (const [file, guard, msg] of routes) {
    it(`${file} returns 400 before any docker call`, () => {
      const s = read(file);
      const g = s.indexOf(`!${guard}(id)`);
      assert.ok(g > 0, "guard present");
      assert.ok(s.includes(msg) && s.slice(g).includes("status: 400"));
      assert.ok(g < s.search(/docker\.|containerStats\(|containerLogs\(|removeImage\(id/), "guard precedes docker use");
    });
  }
  it("logs route uses clampLogsTail", () => {
    assert.ok(read("app/api/docker/containers/[id]/logs/route.ts").includes("clampLogsTail(req.nextUrl.searchParams.get(\"tail\"))"));
  });
  it("clampLogsTail: missing/blank/0/non-numeric 200, negative 1, floor, cap 5000", () => {
    const cases: [string | undefined, number][] = [
      [undefined, 200], ["", 200], ["0", 200], ["abc", 200], ["-5", 1], ["2.7", 2], ["200", 200], ["99999", 5000],
    ];
    for (const [raw, want] of cases) assert.equal(clampLogsTail(raw), want, `tail=${JSON.stringify(raw)}`);
  });
});

describe("disk-scan job map", () => {
  it("sweeps expired jobs when a new job starts", () => {
    const s = read("lib/disk-scan.ts");
    const sweep = s.indexOf("if (isExpired(j)) jobs().delete(jid)");
    assert.ok(sweep > 0 && sweep < s.indexOf("jobs().set(id, job)"));
  });
});
