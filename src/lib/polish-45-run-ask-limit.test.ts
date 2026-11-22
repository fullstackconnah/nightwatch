import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The route imports through the "@/" alias, which node --test cannot resolve, so this reads its source.
const src = readFileSync(new URL("../app/api/hermes-ctl/run/route.ts", import.meta.url), "utf8");
const post = src.slice(src.indexOf("export async function POST"));

describe("hermes-ctl run route: kiosk ask limit (H166-1)", () => {
  it("applies allowAsk after the 403 and before runHermesJob", () => {
    const forbidden = post.indexOf("kind not available to the kiosk");
    const gate = post.indexOf("allowAsk(");
    const run = post.indexOf("runHermesJob(");
    assert.ok(gate > forbidden && forbidden > 0, "allowAsk must come after the 403");
    assert.ok(run > gate, "allowAsk must come before runHermesJob");
  });

  it("limits only a session-less ask", () => {
    assert.match(post, /!hasSession\s*&&\s*body\.kind === "ask"/);
  });

  it("answers 429 with the assistant route's two messages", () => {
    assert.match(post, /status: 429/);
    assert.ok(post.includes("That's all the questions I can take today."));
    assert.ok(post.includes("One question at a time. Try again in a few seconds."));
  });
});
