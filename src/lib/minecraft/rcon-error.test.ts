import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { rconErrorCopy } from "./rcon-error.ts";

describe("rconErrorCopy", () => {
  it("names the cause for auth and unreachable", () => {
    assert.equal(rconErrorCopy("rcon auth failed"), "The Minecraft server rejected the RCON password.");
    assert.equal(rconErrorCopy("rcon unreachable"), "The Minecraft server didn't answer on the RCON port.");
  });
  it("gives null for anything else", () => {
    for (const m of [undefined, "rcon malformed frame", "rcon protocol error", "ECONNRESET", "constructor"]) {
      assert.equal(rconErrorCopy(m), null);
    }
  });
  it("the route uses it and stays 502, never 401", () => {
    const src = readFileSync(new URL("../../app/api/minecraft/rcon/route.ts", import.meta.url), "utf8");
    assert.ok(src.includes("rconErrorCopy(") && src.includes("status: 502") && !src.includes("status: 401"));
  });
});
