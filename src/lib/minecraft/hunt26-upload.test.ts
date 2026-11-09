import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { uploadFieldsError } from "./pack-check.ts";
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

test("contentLengthError noun", () => {
  assert.equal(contentLengthError("9999999999", 2 * 1024 ** 3, "The pack")?.detail, "The pack exceeds the 2048MB limit.");
  assert.match(contentLengthError("9999999999", 1024)?.detail ?? "", /^Audio exceeds/);
});

test("route wiring", () => {
  const at = (re: RegExp) => route.search(re);
  assert.ok(at(/uploadFieldsError\(/) > -1 && at(/uploadFieldsError\(/) < at(/await fetch\(|res = await fetch\(/));
  assert.ok(at(/contentLengthError\(/) > -1 && at(/contentLengthError\(/) < at(/res = await fetch\(/));
  assert.match(route, /query\.set\("loaderVersion"/);
  assert.match(route, /multipart\/form-data/);
  assert.match(route, /TimeoutError/);
  assert.match(route, /status: 504/);
});
