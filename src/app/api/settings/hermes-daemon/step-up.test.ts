import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

// The route imports "@/lib/..." and "next/server", which plain node cannot resolve; map them for this process only.
const SRC = new URL("../../../../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  if (s === "next/server" || s === "next/headers") return next(s + ".js", c);
  return next(s, c);
}`));
const { NextRequest } = await import("next/server");
const { default: bcrypt } = await import("bcryptjs");
const { POST } = await import("./route.ts");

const PASSWORD = "correct horse battery";
const HASH = bcrypt.hashSync(PASSWORD, 4);
const ENV = ["DATA_DIR", "SESSION_SECRET", "ADMIN_PASSWORD_HASH"] as const;
const saved: Record<string, string | undefined> = {};
const realCompare = bcrypt.compare;
let dir = "";
let file = "";

const STORED = { discordBotToken: "old-token", discordAllowedUserIds: ["111111111111111111", "222222222222222222"], discordChannelId: "999999999999999999", dryRun: false, updatedAt: "2026-01-01T00:00:00.000Z" };

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-step-up-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = "test-only-hermes-step-up-secret";
  process.env.ADMIN_PASSWORD_HASH = HASH;
  fs.mkdirSync(path.join(dir, "hermes"));
  file = path.join(dir, "hermes", "hermes-settings.json");
  fs.writeFileSync(file, JSON.stringify(STORED));
  // One shared counter (step-up.ts keeps it on globalThis); a wrong guess in one case must not lock the next.
  (globalThis as unknown as { __nwStepUpLimiter?: { reset(): void } }).__nwStepUpLimiter?.reset();
});
afterEach(() => {
  bcrypt.compare = realCompare;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function post(patch: unknown) {
  const body = JSON.stringify(patch);
  return POST(new NextRequest("http://localhost/api/settings/hermes-daemon", {
    method: "POST",
    body,
    headers: { "content-length": String(Buffer.byteLength(body)) },
  }));
}
const bytes = () => fs.readFileSync(file);
const stored = () => JSON.parse(fs.readFileSync(file, "utf8"));

describe("POST /api/settings/hermes-daemon: Discord access asks for the current password", () => {
  it("a new allowlist with no password is refused 400 and the file is byte-identical", async () => {
    const before = bytes();
    const res = await post({ discordAllowedUserIds: ["111111111111111111", "222222222222222222", "333333333333333333"] });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Enter your current password to change this.", stepUp: "missing" });
    assert.ok(bytes().equals(before));
  });

  it("a wrong password is 403 and the file is unchanged; the sixth try is locked out with 429", async () => {
    const before = bytes();
    const patch = { discordBotToken: "new-token", currentPassword: "nope" };
    const res = await post(patch);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Current password is incorrect.", stepUp: "wrong" });
    for (let i = 0; i < 4; i++) assert.equal((await post(patch)).status, 403);
    const locked = await post(patch);
    assert.equal(locked.status, 429);
    assert.deepEqual(await locked.json(), { error: "Too many attempts. Wait a minute and try again.", stepUp: "limited" });
    assert.ok(bytes().equals(before));
  });

  it("the right password saves the change", async () => {
    const res = await post({ discordBotToken: "new-token", discordAllowedUserIds: ["111111111111111111"], currentPassword: PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(stored().discordBotToken, "new-token");
    assert.deepEqual(stored().discordAllowedUserIds, ["111111111111111111"]);
  });

  it("a changed channel id alone is gated", async () => {
    const before = bytes();
    const res = await post({ discordChannelId: "888888888888888888" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).stepUp, "missing");
    assert.ok(bytes().equals(before));
  });

  it("clearing the webhook or the bot token is gated", async () => {
    assert.equal((await post({ clearDiscordWebhookUrl: true })).status, 400);
    assert.equal((await post({ clearDiscordBotToken: true })).status, 400);
  });

  it("a save of only dry run, pipeline or an unchanged allowlist and channel needs no password", async () => {
    assert.equal((await post({ dryRun: true })).status, 200);
    assert.equal((await post({ pipelineEnabled: true })).status, 200);
    assert.equal((await post({ discordAllowedUserIds: ["111111111111111111", " 222222222222222222 "], discordChannelId: "999999999999999999", dryRun: false })).status, 200);
    assert.equal(stored().pipelineEnabled, true);
  });

  it("a field error is answered before the password check and uses no attempt", async () => {
    const res = await post({ discordBotToken: "new-token", digestHour: 99, currentPassword: "nope" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).stepUp, undefined);
  });

  it("with no admin password configured a gated change saves", async () => {
    delete process.env.ADMIN_PASSWORD_HASH;
    const res = await post({ discordAllowedUserIds: ["333333333333333333"] });
    assert.equal(res.status, 200);
    assert.deepEqual(stored().discordAllowedUserIds, ["333333333333333333"]);
  });

  it("answers 409 and saves nothing when the file changes while the password is checked", async () => {
    bcrypt.compare = (async (...a: Parameters<typeof realCompare>) => {
      fs.writeFileSync(file, JSON.stringify({ ...STORED, discordChannelId: "777777777777777777" }));
      return (realCompare as (...x: unknown[]) => Promise<boolean>)(...a);
    }) as typeof realCompare;
    const res = await post({ discordBotToken: "new-token", currentPassword: PASSWORD });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /Settings changed while the password was checked/);
    assert.equal(stored().discordChannelId, "777777777777777777");
    assert.equal(stored().discordBotToken, "old-token");
  });
});
