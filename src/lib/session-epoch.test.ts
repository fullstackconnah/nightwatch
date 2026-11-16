import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { SignJWT } from "jose";
import { createKioskElevationToken, createSessionToken, isRequestAuthenticated, verifySessionToken } from "./auth.ts";
import { epochOf, loadConfig, saveConfig, sessionEpoch } from "./config.ts";
import { ALLOW_ENV_NAME, ALLOW_SETTING_KEY, allowListSetting, parseAllowList } from "./oidc-allow.ts";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (rel: string) => fs.readFileSync(path.join(here, rel), "utf8");
const FAKE_SECRET = "test-only-session-secret-not-real";

let savedSecret: string | undefined;
before(() => {
  savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = FAKE_SECRET;
});
after(() => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
});

const signRaw = (payload: Record<string, unknown>) =>
  new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(FAKE_SECRET));

describe("session epoch: token (PR B)", () => {
  it("a token verifies at its own epoch and below, not above", async () => {
    const t = await createSessionToken(3);
    assert.equal(await verifySessionToken(t, 3), true);
    assert.equal(await verifySessionToken(t, 2), true);
    assert.equal(await verifySessionToken(t, 4), false);
  });
  it("a token without ep counts as 0", async () => {
    const t = await signRaw({ sub: "admin", typ: "session" });
    assert.equal(await verifySessionToken(t, 0), true);
    assert.equal(await verifySessionToken(t, 1), false);
  });
  it("a malformed ep is refused", async () => {
    for (const ep of ["5", -1, 1.5, null]) assert.equal(await verifySessionToken(await signRaw({ sub: "admin", typ: "session", ep }), 0), false, String(ep));
  });
  it("a non-integer epoch argument fails closed", async () => {
    const t = await createSessionToken(0);
    for (const e of [undefined, NaN, 1.5, "0"]) assert.equal(await verifySessionToken(t, e as unknown as number), false, String(e));
  });
  it("isRequestAuthenticated honours the epoch for sessions, never for kiosk elevation", async () => {
    const old = await createSessionToken(0);
    assert.equal(await isRequestAuthenticated(old, undefined, "GET", "/api/x", 1), false);
    assert.equal(await isRequestAuthenticated(undefined, await createKioskElevationToken(), "GET", "/api/docker/containers", 9), true);
  });
});

describe("session epoch: stored value (PR B)", () => {
  let dir = "";
  let prev: string | undefined;
  let n = 0;
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-epoch-"));
    process.env.DATA_DIR = dir;
    saveConfig(loadConfig()); // resets the loadConfig cache for this dir
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const writeRaw = (system: unknown) => {
    const f = path.join(dir, "config.json");
    fs.writeFileSync(f, JSON.stringify({ system }));
    const t = new Date(Date.now() + 10_000 * ++n); // a unique mtime so the cache cannot serve another case's file
    fs.utimesSync(f, t, t);
  };
  it("is 0 with no stored value", () => assert.equal(sessionEpoch(), 0));
  it("reads a stored epoch", () => {
    writeRaw({ sessionEpoch: 4 });
    assert.equal(sessionEpoch(), 4);
  });
  it("treats a malformed stored epoch as 0", () => {
    for (const v of ["4", -1, 1.5, null]) {
      writeRaw({ sessionEpoch: v });
      assert.equal(sessionEpoch(), 0, String(v));
    }
  });
  it("epochOf accepts only non-negative safe integers", () => {
    assert.deepEqual([0, 7, 2 ** 53].map(epochOf), [0, 7, 0]);
    assert.deepEqual(["1", NaN, undefined, -3, 0.5].map(epochOf), [0, 0, 0, 0, 0]);
  });
});

describe("session epoch: source guards (PR B)", () => {
  const srcRoot = path.join(here, "..");
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const sources = walk(srcRoot).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("every file that calls verifySessionToken( also reads sessionEpoch()", () => {
    const callers = sources.filter((f) => !f.endsWith(`${path.sep}auth.ts`) && fs.readFileSync(f, "utf8").includes("verifySessionToken("));
    assert.ok(callers.length >= 6, `found ${callers.length} callers`);
    for (const f of callers) assert.ok(fs.readFileSync(f, "utf8").includes("sessionEpoch()"), f);
  });
  it("every createSessionToken( caller passes a stored epoch", () => {
    for (const f of sources.filter((f) => !f.endsWith(`${path.sep}auth.ts`))) {
      const s = fs.readFileSync(f, "utf8");
      for (const m of s.matchAll(/createSessionToken\((.{0,16})/g)) assert.match(m[1], /^(sessionEpoch\(\)|epochOf\()/, f);
    }
  });
  it("the middleware runs on Node and passes the epoch", () => {
    const s = read("../middleware.ts");
    assert.match(s, /runtime: "nodejs"/);
    assert.match(s, /sessionEpoch\(\),\s*\)/);
  });
  it("the password route bumps the epoch in the same literal as the new hash, then re-issues the cookie after saving", () => {
    const s = read("../app/api/settings/password/route.ts");
    assert.match(s, /adminPasswordHash: newHash, sessionEpoch: epochOf\(/);
    assert.ok(s.indexOf("saveConfig(next)") < s.indexOf("res.cookies.set(SESSION_COOKIE"));
  });
  it("the System-card save keeps the stored epoch by spreading the existing system", () => {
    assert.match(read("../app/api/settings/system/route.ts"), /\.\.\.existing/);
  });
});

describe("OIDC allow-list setting (PR B)", () => {
  it("a stored value with no entries falls back to the environment value", () => {
    for (const stored of ["", "  ", " , ,\n"]) assert.equal(allowListSetting(stored, " abc "), "abc");
    assert.equal(allowListSetting(undefined, undefined), undefined);
    assert.equal(allowListSetting(" , ", "  "), undefined);
  });
  it("a stored value with an entry wins over the environment", () => {
    assert.equal(allowListSetting("a, b", "env"), "a, b");
    assert.deepEqual(parseAllowList("a, b\nc"), ["a", "b", "c"]);
  });
  it("the key and env names match .env.example, the README and oidc.ts", () => {
    assert.equal(ALLOW_SETTING_KEY, "oidcAllowedUsers");
    assert.equal(ALLOW_ENV_NAME, "OIDC_ALLOWED_USERS");
    const root = path.join(here, "../..");
    assert.match(fs.readFileSync(path.join(root, ".env.example"), "utf8"), new RegExp(`^# ${ALLOW_ENV_NAME}=`, "m"));
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    assert.ok(readme.includes(ALLOW_ENV_NAME) && readme.includes(ALLOW_SETTING_KEY));
    const oidc = read("oidc.ts");
    assert.ok(oidc.includes("ALLOW_SETTING_KEY") && oidc.includes("ALLOW_ENV_NAME") && !oidc.includes('"OIDC_ALLOWED_USERS"'));
  });
});
