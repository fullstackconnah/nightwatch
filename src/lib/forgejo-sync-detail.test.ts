import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/* Source scan (forgejo.ts imports the "@/" alias, so it can't load under node:test): R12, a failed Sync never carries Forgejo's raw body. */

const src = readFileSync(new URL("./forgejo.ts", import.meta.url), "utf8");
const fn = src.slice(src.indexOf("export async function triggerPushMirrorSync"));

describe("triggerPushMirrorSync failure detail", () => {
  it("never reads the upstream response body", () => {
    assert.ok(!/res\.(text|json)\(/.test(fn));
  });
  it("answers other statuses with the plain HTTP line", () => {
    assert.ok(fn.includes("detail: `Forgejo returned HTTP ${res.status}.`"));
  });
});
