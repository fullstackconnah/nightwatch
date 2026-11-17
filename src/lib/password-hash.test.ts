import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { choosePasswordHashes, matchesAny } from "./password-hash.ts";

// Placeholders only: the chooser never parses a hash.
const STORED = "stored-hash-placeholder";
const ENV = "env-hash-placeholder";

describe("choosePasswordHashes (stored hash wins over env)", () => {
  it("stored and env set: stored only", () => {
    assert.deepEqual(choosePasswordHashes(STORED, ENV), [{ hash: STORED, source: "config" }]);
  });
  it("stored set, env unset: stored only", () => {
    assert.deepEqual(choosePasswordHashes(STORED, undefined), [{ hash: STORED, source: "config" }]);
  });
  for (const blank of [undefined, "", "   "]) {
    it(`stored ${JSON.stringify(blank)}, env set: env only`, () => {
      assert.deepEqual(choosePasswordHashes(blank, ` ${ENV} `), [{ hash: ENV, source: "env" }]);
    });
  }
  it("neither set: none", () => {
    assert.deepEqual(choosePasswordHashes(undefined, undefined), []);
    assert.deepEqual(choosePasswordHashes("  ", ""), []);
  });
  it("removing the stored hash puts env back (recovery)", () => {
    assert.equal(choosePasswordHashes(STORED, ENV)[0].hash, STORED);
    assert.equal(choosePasswordHashes(undefined, ENV)[0].hash, ENV);
  });
  it("auth-server.ts delegates to it and the docs state the rule", () => {
    assert.match(readFileSync(new URL("./auth-server.ts", import.meta.url), "utf8"), /choosePasswordHashes\(/);
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    assert.doesNotMatch(readme, /still accepts the old password/);
  });
});

describe("matchesAny (a hash that cannot be compared is a non-match)", () => {
  const compare = async (pw: string, hash: string) => {
    if (hash === "damaged") throw new Error("Illegal hash");
    return hash === `hash-of-${pw}`;
  };
  it("match", async () => assert.equal(await matchesAny("a", ["hash-of-a"], compare), true));
  it("no match", async () => assert.equal(await matchesAny("b", ["hash-of-a"], compare), false));
  it("compare rejects: false, not a throw", async () => assert.equal(await matchesAny("a", ["damaged"], compare), false));
  it("a damaged hash does not hide a later match", async () => assert.equal(await matchesAny("a", ["damaged", "hash-of-a"], compare), true));
  it("empty list", async () => assert.equal(await matchesAny("a", [], compare), false));
});

describe("auth source guards", () => {
  const walk = (dir: URL): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : [fileURLToPath(new URL(e.name, dir))]);
  it("process.env.ADMIN_PASSWORD_HASH is read only in auth-server.ts", () => {
    const hits = walk(new URL("../", import.meta.url))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("process.env.ADMIN_PASSWORD_HASH"));
    assert.deepEqual(hits.map((f) => f.replaceAll("\\", "/").split("/src/")[1]), ["lib/auth-server.ts"]);
  });
  it("no api route calls bcrypt.compare directly; Settings authConfigured uses the login candidates", () => {
    for (const f of walk(new URL("../app/api/", import.meta.url)).filter((f) => /\.ts$/.test(f))) {
      assert.doesNotMatch(readFileSync(f, "utf8"), /bcrypt\.compare\s*\(/, f);
    }
    const settings = readFileSync(new URL("../app/api/settings/route.ts", import.meta.url), "utf8");
    assert.match(settings, /authConfigured: candidatePasswordHashes\(\)\.length > 0/);
  });
});
