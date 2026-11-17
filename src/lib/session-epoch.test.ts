import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { SignJWT } from "jose";
import { createKioskElevationToken, createSessionToken, isRequestAuthenticated, verifyKioskElevationToken, verifySessionToken } from "./auth.ts";
import { AUTH_STATE_UNREADABLE, epochOf, loadConfig, loadAuthState, readAuthStateForSave, saveAuthState, saveConfig, seedAuthState, sessionEpoch } from "./config.ts";
import { storedHashFor } from "./password-hash.ts";
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
  it("isRequestAuthenticated honours the epoch for sessions and for kiosk elevation", async () => {
    const old = await createSessionToken(0);
    assert.equal(await isRequestAuthenticated(old, undefined, "GET", "/api/x", 1, "test-tag"), false);
    const k = await createKioskElevationToken(0, "test-tag");
    assert.equal(await isRequestAuthenticated(undefined, k, "GET", "/api/docker/containers", 0, "test-tag"), true);
    assert.equal(await isRequestAuthenticated(undefined, k, "GET", "/api/docker/containers", 1, "test-tag"), false);
  });
  it("an elevation minted at 0 is refused at epoch 1", async () => {
    assert.equal(await verifyKioskElevationToken(await createKioskElevationToken(0, "test-tag"), 1, "test-tag"), false);
  });
  it("an elevation minted at 9 is accepted at 9 and refused at 10", async () => {
    const t = await createKioskElevationToken(9, "test-tag");
    assert.equal(await verifyKioskElevationToken(t, 9, "test-tag"), true);
    assert.equal(await verifyKioskElevationToken(t, 10, "test-tag"), false);
  });
  it("an elevation with no ep counts as 0: accepted at 0, refused at 1; a malformed ep is refused", async () => {
    const t = await signRaw({ sub: "kiosk", kiosk: true, typ: "kiosk", pt: "test-tag" });
    assert.equal(await verifyKioskElevationToken(t, 0, "test-tag"), true);
    assert.equal(await verifyKioskElevationToken(t, 1, "test-tag"), false);
    for (const ep of ["5", -1, 1.5, null]) assert.equal(await verifyKioskElevationToken(await signRaw({ sub: "kiosk", kiosk: true, typ: "kiosk", ep, pt: "test-tag" }), 0, "test-tag"), false, String(ep));
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

describe("session epoch: data/auth.json (revocation survives a config copy)", () => {
  let dir = "";
  let prev: string | undefined;
  let n = 0;
  beforeEach(() => {
    prev = process.env.DATA_DIR;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-auth-"));
    process.env.DATA_DIR = dir;
    saveConfig(loadConfig());
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const stamp = (f: string) => {
    const t = new Date(Date.now() + 10_000 * ++n); // a unique mtime so no cache can serve the previous content
    fs.utimesSync(f, t, t);
  };
  const authFile = () => path.join(dir, "auth.json");
  const writeAuth = (raw: string) => {
    fs.writeFileSync(authFile(), raw);
    stamp(authFile());
  };
  const writeConf = (epoch?: number) => {
    const f = path.join(dir, "config.json");
    fs.writeFileSync(f, JSON.stringify(epoch === undefined ? {} : { system: { sessionEpoch: epoch } }));
    stamp(f);
  };

  it("a copied config with a lower epoch cannot lower the effective epoch", async () => {
    writeAuth('{"sessionEpoch":3}');
    writeConf(0);
    assert.equal(sessionEpoch(), 3);
    writeConf(); // a config with no system key at all
    assert.equal(sessionEpoch(), 3);
    assert.equal(await verifySessionToken(await createSessionToken(2), sessionEpoch()), false);
  });
  it("a saveConfig carrying a lower epoch leaves the effective epoch at the file's value", () => {
    writeAuth('{"sessionEpoch":5}');
    const c = loadConfig();
    saveConfig({ ...c, system: { ...c.system, sessionEpoch: 1 } });
    assert.equal(sessionEpoch(), 5);
  });
  it("a missing auth.json keeps the config epoch, and a higher config epoch still wins", () => {
    writeConf(4);
    assert.equal(sessionEpoch(), 4);
    writeAuth('{"sessionEpoch":2}');
    assert.equal(sessionEpoch(), 4);
  });
  it("an empty, malformed, non-object or wrongly typed auth.json falls back to the config epoch without throwing", () => {
    writeConf(4);
    for (const raw of ["", "{", "[]", '{"sessionEpoch":"9"}']) {
      writeAuth(raw);
      assert.equal(sessionEpoch(), 4, JSON.stringify(raw));
    }
  });
  it("a file that turns malformed after a good read keeps the last good value", () => {
    writeConf(1);
    writeAuth('{"sessionEpoch":6}');
    assert.equal(sessionEpoch(), 6);
    writeAuth("{");
    assert.equal(sessionEpoch(), 6);
    assert.equal(sessionEpoch(), 6); // not re-parsed, same answer
  });
  it("a save keeps its state as the last good one when the file then turns malformed", () => {
    writeConf(1);
    saveAuthState({ sessionEpoch: 7 });
    writeAuth("{");
    assert.equal(sessionEpoch(), 7);
  });
  it("auth.json is re-read after its mtime changes", () => {
    writeAuth('{"sessionEpoch":3}');
    assert.equal(sessionEpoch(), 3);
    writeAuth('{"sessionEpoch":5}');
    assert.equal(sessionEpoch(), 5);
  });
  const writeConfHash = (hash: string, epoch = 0) => {
    const f = path.join(dir, "config.json");
    fs.writeFileSync(f, JSON.stringify({ system: { adminPasswordHash: hash, sessionEpoch: epoch } }));
    stamp(f);
  };
  const authJson = () => JSON.parse(fs.readFileSync(authFile(), "utf8"));
  const hashRule = () => storedHashFor(loadAuthState(), loadConfig().system?.adminPasswordHash);
  it("the v2 seed copies the config hash once and never again", () => {
    writeConfHash("hash-from-config", 4);
    seedAuthState();
    const a = authJson();
    assert.deepEqual([a.v, a.sessionEpoch, a.adminPasswordHash], [2, 4, "hash-from-config"]);
    writeConfHash("copied-in-later", 9);
    seedAuthState();
    assert.deepEqual([authJson().sessionEpoch, authJson().adminPasswordHash], [4, "hash-from-config"]);
  });
  it("the seed creates the file at epoch 0 and without a config hash", () => {
    seedAuthState();
    const a = authJson();
    assert.equal(a.v, 2);
    assert.equal(a.sessionEpoch, 0);
    assert.equal("adminPasswordHash" in a, false);
  });
  it("the seed writes nothing while config.json is unreadable, and seeds the hash once it is repaired", () => {
    const f = path.join(dir, "config.json");
    fs.writeFileSync(f, "{ not json");
    stamp(f);
    seedAuthState();
    assert.equal(fs.existsSync(authFile()), false, "malformed config: nothing written");
    fs.rmSync(f);
    fs.mkdirSync(f); // EISDIR
    seedAuthState();
    assert.equal(fs.existsSync(authFile()), false, "unreadable config: nothing written");
    fs.rmdirSync(f);
    writeConfHash("hash-from-config", 3);
    seedAuthState();
    assert.deepEqual([authJson().v, authJson().sessionEpoch, authJson().adminPasswordHash], [2, 3, "hash-from-config"]);
  });
  it("the seed still seeds a fresh install with no config.json", () => {
    fs.rmSync(path.join(dir, "config.json"));
    seedAuthState();
    const a = authJson();
    assert.deepEqual([a.v, a.sessionEpoch, "adminPasswordHash" in a], [2, 0, false]);
  });
  it("the seed upgrades a readable file without v: keeps its keys and the higher epoch, skips a blank config hash", () => {
    writeConfHash("  ", 2);
    writeAuth('{"sessionEpoch":7,"keep":"x"}');
    seedAuthState();
    const a = authJson();
    assert.deepEqual([a.v, a.sessionEpoch, a.keep], [2, 7, "x"]);
    assert.equal("adminPasswordHash" in a, false);
  });
  it("the seed never touches a v 2 file", () => {
    writeConfHash("from-config", 9);
    const raw = '{"v":2,"sessionEpoch":1}';
    writeAuth(raw);
    seedAuthState();
    assert.equal(fs.readFileSync(authFile(), "utf8"), raw);
  });
  it("the seed never overwrites a malformed or unreadable file", () => {
    writeConfHash("from-config", 9);
    writeAuth("{");
    seedAuthState();
    assert.equal(fs.readFileSync(authFile(), "utf8"), "{");
    fs.rmSync(authFile());
    fs.mkdirSync(authFile());
    seedAuthState();
    assert.ok(fs.statSync(authFile()).isDirectory());
  });
  it("with v 2 and a blank hash a config hash is ignored; a failed read after a good v 2 read keeps the rule", () => {
    writeConfHash("from-config");
    assert.equal(hashRule(), "from-config", "missing file: config");
    writeAuth('{"v":2,"adminPasswordHash":"  "}');
    assert.equal(hashRule(), undefined, "blank: none, and not the config hash");
    writeAuth('{"v":2,"adminPasswordHash":"auth-hash"}');
    assert.equal(hashRule(), "auth-hash");
    writeAuth("{");
    assert.equal(hashRule(), "auth-hash", "last good state");
  });
  it("a cold start with a malformed file falls back to the config hash", () => {
    writeConfHash("from-config");
    writeAuth("{");
    assert.equal(hashRule(), "from-config");
  });
  it("the strict read returns {} when missing and throws on a malformed or unreadable file", () => {
    assert.deepEqual(readAuthStateForSave(), {});
    writeAuth("{");
    assert.throws(() => readAuthStateForSave(), { message: AUTH_STATE_UNREADABLE });
    fs.rmSync(authFile());
    fs.mkdirSync(authFile()); // a directory forces EISDIR without chmod
    assert.throws(() => readAuthStateForSave(), { message: AUTH_STATE_UNREADABLE });
    assert.equal(sessionEpoch(), 0, "the loose read still never throws");
  });
  it("saveAuthState writes atomically, keeps unknown keys and drops a leftover .tmp", () => {
    fs.writeFileSync(authFile() + ".tmp", "stale");
    saveAuthState({ sessionEpoch: 2, keep: "x" });
    assert.deepEqual(readAuthStateForSave(), { sessionEpoch: 2, keep: "x" });
    assert.equal(fs.existsSync(authFile() + ".tmp"), false);
    assert.equal(sessionEpoch(), 2);
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
  // Guard regexes: a longer identifier that merely contains the name must not count as a caller.
  const CREATE_KIOSK = /\bcreateKioskElevationToken\((.{0,16})/g;
  const VERIFY_KIOSK = /\bverifyKioskElevationToken\(/g;
  it("the kiosk guard regexes match the exact identifier only", () => {
    for (const [re, name] of [[CREATE_KIOSK, "createKioskElevationToken"], [VERIFY_KIOSK, "verifyKioskElevationToken"]] as const) {
      assert.equal([...`x = ${name}(epoch)`.matchAll(re)].length, 1, `${name} matches`);
      assert.equal([...`x = re${name}(epoch)`.matchAll(re)].length, 0, `re${name} must not match`);
    }
  });
  it("every kiosk elevation create/verify caller passes the stored epoch", () => {
    let n = 0;
    for (const f of sources.filter((f) => !f.endsWith(`${path.sep}auth.ts`))) {
      const s = fs.readFileSync(f, "utf8");
      // `epoch` is allowed only where the file binds it to sessionEpoch() (the refresh route reads it once).
      const epochOk = /const epoch = sessionEpoch\(\);/.test(s) ? "epoch|" : "";
      const okArg = new RegExp(`^(${epochOk}sessionEpoch\\(\\)|epochOf\\()`);
      for (const m of s.matchAll(CREATE_KIOSK)) { n++; assert.match(m[1], okArg, f); }
      const verifies = [...s.matchAll(VERIFY_KIOSK)].length;
      n += verifies;
      assert.equal(s.match(new RegExp(`\\bverifyKioskElevationToken\\(\\w+, (${epochOk}sessionEpoch\\(\\)|epochOf\\()`, "g"))?.length ?? 0, verifies, f);
    }
    assert.ok(n >= 4, `found ${n} callers`);
  });
  it("the kiosk refresh route verifies against sessionEpoch() before it re-mints", () => {
    const s = read("../app/api/auth/kiosk/refresh/route.ts");
    assert.match(s, /const epoch = sessionEpoch\(\);/);
    assert.match(s, /verifyKioskElevationToken\(token, epoch, pinTag\)/);
    assert.match(s, /createKioskElevationToken\(epoch, pinTag\)/);
    assert.ok(s.indexOf("verifyKioskElevationToken(") < s.indexOf("createKioskElevationToken("));
  });
  it("the middleware runs on Node and passes the epoch", () => {
    const s = read("../middleware.ts");
    assert.match(s, /runtime: "nodejs"/);
    assert.match(s, /sessionEpoch\(\),\s*elevation \? await kioskPinTag/);
  });
  it("the password route bumps the higher of both stores, writes auth.json first, mirrors into the config, then re-issues the cookie", () => {
    const s = read("../app/api/settings/password/route.ts");
    assert.match(s, /Math\.max\(epochOf\(auth\.sessionEpoch\), epochOf\(current\.system\?\.sessionEpoch\)\) \+ 1/);
    assert.match(s, /adminPasswordHash: newHash, sessionEpoch: nextEpoch/);
    assert.match(s, /saveAuthState\(\{[^}]*v: 2, adminPasswordHash: newHash[^}]*\}\)/);
    assert.match(s, /Number\.isSafeInteger\(nextEpoch\)/);
    assert.doesNotMatch(s, /save failed/, "a failed config mirror no longer answers 500: the password has changed");
    assert.ok(s.indexOf("saveAuthState(") < s.indexOf("saveConfig(next)"));
    assert.ok(s.indexOf("saveConfig(next)") < s.indexOf("res.cookies.set(SESSION_COOKIE"));
    assert.match(s, /createSessionToken\(epochOf\(nextEpoch\)\)/);
  });
  it("instrumentation seeds auth.json on the Node runtime", () => assert.match(read("../instrumentation.ts"), /seedAuthState\(\)/));
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
