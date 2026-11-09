import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { uploadFieldsError, packPageUrlOk, packFieldsError } from "./pack-check.ts";
import { contentLengthError } from "../upload-limit.ts";

const route = readFileSync(
  fileURLToPath(new URL("../../app/api/minecraft/instances/upload/route.ts", import.meta.url)),
  "utf8",
);

test("mcVersion must be a version", () => {
  assert.equal(uploadFieldsError("1.21.1", undefined), null);
  for (const bad of ["1.21.1\nJVM_OPTS=x", "1.21.1 x", ""]) {
    assert.match(uploadFieldsError(bad, undefined) ?? "", /mcVersion must look like a Minecraft version/);
  }
});

test("loaderVersion is optional but must be a version", () => {
  assert.equal(uploadFieldsError("1.21.1", undefined), null);
  assert.equal(uploadFieldsError("1.21.1", "21.1.77"), null);
  assert.equal(uploadFieldsError("1.21.1", "0.16.9+build.1"), null);
  for (const bad of ["21.1\nX=1", "$HOME", "a=b", "1".repeat(65)]) {
    assert.match(uploadFieldsError("1.21.1", bad) ?? "", /loaderVersion must be a version/);
  }
});

test("pack page url refuses control characters", () => {
  for (const bad of ["https://www.curseforge.com/x\nJVM_OPTS=1", "https://modrinth.com/x\r\nA=1", "https://modrinth.com/x\ty", "https://modrinth.com/x\u0000"]) {
    assert.equal(packPageUrlOk(bad), false);
    assert.match(packFieldsError({ name: "n", pageUrl: bad }) ?? "", /pack\.pageUrl/);
  }
  assert.equal(packPageUrlOk("https://www.curseforge.com/minecraft/modpacks/x"), true);
});

test("contentLengthError noun", () => {
  assert.equal(contentLengthError("9999999999", 2 * 1024 ** 3, "The pack")?.detail, "The pack exceeds the 2048MB limit.");
  assert.match(contentLengthError("9999999999", 1024)?.detail ?? "", /^Audio exceeds/);
});

test("route wiring", () => {
  const at = (re: RegExp) => route.search(re);
  const fetchAt = at(/res = await fetch\(/);
  const fieldsAt = at(/if \(fieldsError\) return NextResponse\.json/);
  assert.ok(fieldsAt > -1 && fieldsAt < fetchAt);
  const bigAt = at(/if \(tooBig\) return NextResponse\.json/);
  assert.ok(bigAt > -1 && bigAt < fetchAt);
  assert.match(route, /query\.set\("loaderVersion"/);
  assert.match(route, /multipart\/form-data/);
  assert.match(route, /TimeoutError/);
  assert.match(route, /status: 504/);
});
