import test, { mock } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OUTSIDE_START,
  OUTSIDE_STREAK,
  classifyAnswer,
  classifyConnectError,
  createOutsideTracker,
  fakeReadings,
  hostnameError,
  isPublicIPv4,
  mergeOutsideHost,
  nextOutside,
  outsideCopy,
  outsideRun,
  pickReader,
  pinnedLookup,
  readOutside,
  realDeps,
  type DownWhy,
  type EdgeAnswer,
  type OutsideDeps,
  type OutsideReading,
  type UncheckedWhy,
} from "./outside-check.ts";
import { outsideDown, outsideUnchecked } from "./attention-copy.ts";
import { runProbes, toHits, type AttentionReport, type ProbeDef } from "./attention-report.ts";
import { answerFor, homeRows } from "./home.ts";

const HOST = "status.example.com";
const BAD_HOST_MSG = "Use a plain name like status.example.com, with no https://, port or path.";
const edge = (over: Partial<EdgeAnswer> = {}): EdgeAnswer => ({ status: 200, cfRay: true, mitigated: false, ...over });
const deps = (over: Partial<OutsideDeps> = {}) => {
  const calls = { resolve: 0, connect: [] as string[] };
  const d: OutsideDeps = {
    async resolveA() {
      calls.resolve++;
      return { kind: "found", addrs: ["104.16.0.1"] };
    },
    async connect(_h, ip) {
      calls.connect.push(ip);
      return edge();
    },
    ...over,
  };
  return { d, calls };
};
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const D = (why: DownWhy): OutsideReading => ({ kind: "down", why });
const U = (why: UncheckedWhy): OutsideReading => ({ kind: "unchecked", why });
const UP: OutsideReading = { kind: "up" };
const run = (rs: OutsideReading[]) => rs.reduce(nextOutside, OUTSIDE_START);

/** A report whose single probe is the outside check, built the way computeReport builds one. */
async function reportFor(st: ReturnType<typeof run>): Promise<AttentionReport> {
  const defs: ProbeDef[] = [
    {
      id: "outside",
      label: "Outside access",
      run: () => {
        const c = outsideCopy(st);
        return c ? [{ subject: "outside", severity: "bad", ...c }] : [];
      },
    },
  ];
  const outcomes = await runProbes(defs, 1000);
  return {
    checkedAt: "2026-11-12T08:30:00.000Z",
    probes: outcomes.map((o) => o.status),
    hits: toHits(outcomes, () => "2026-11-12T08:00:00.000Z"),
    changes: { since: "2026-11-11T08:30:00.000Z", status: "answered", events: [] },
  };
}

test("1 split DNS: the pinned public address is used and the system resolver is never asked", async () => {
  const { d, calls } = deps();
  assert.deepEqual(await readOutside(HOST, d), { kind: "up" });
  assert.deepEqual(calls.connect, ["104.16.0.1"]);
  const look = pinnedLookup("104.16.0.1") as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void;
  let all: unknown[] = [];
  look(HOST, { all: true }, (...a) => (all = a));
  assert.deepEqual(all, [null, [{ address: "104.16.0.1", family: 4 }]]);
  let one: unknown[] = [];
  look(HOST, {}, (...a) => (one = a));
  assert.deepEqual(one, [null, "104.16.0.1", 4]);
});

test("2 an answer without cf-ray is never up", async () => {
  const { d } = deps({ connect: async () => edge({ cfRay: false }) });
  assert.deepEqual(await readOutside(HOST, d), U("not-via-cloudflare"));
});

test("3 a private or reserved answer is refused with no connection", async () => {
  for (const ip of ["192.168.1.10", "198.18.0.1", "192.0.0.1", "169.254.169.254", "100.127.255.255", "10.0.0.1", "127.0.0.1", "100.64.0.1", "169.254.1.1", "0.0.0.0", "172.16.0.1", "224.0.0.1", "255.255.255.255"]) {
    const { d, calls } = deps({ resolveA: async () => ({ kind: "found", addrs: [ip] }) });
    assert.deepEqual(await readOutside(HOST, d), D("private-address"), ip);
    assert.equal(calls.connect.length, 0, ip);
  }
  const mixed = deps({ resolveA: async () => ({ kind: "found", addrs: ["104.16.0.1", "10.0.0.1"] }) });
  assert.deepEqual(await readOutside(HOST, mixed.d), D("private-address"));
  assert.equal(mixed.calls.connect.length, 0);
  assert.equal(isPublicIPv4("172.67.1.1"), true);
  assert.equal(isPublicIPv4("104.16.0.1"), true);
  assert.equal(isPublicIPv4("not an ip"), false);
  assert.equal(isPublicIPv4("::1"), false);
});

test("4 one failure does not alarm; the third does; one up clears", () => {
  assert.equal(OUTSIDE_STREAK, 3);
  assert.equal(run([UP, D("timeout")]).shown, "clear");
  assert.equal(run([UP, D("timeout"), D("timeout")]).shown, "clear");
  const down = run([UP, D("timeout"), D("timeout"), D("timeout")]);
  assert.equal(down.shown, "down");
  assert.equal(down.downWhy, "timeout");
  assert.equal(nextOutside(down, UP).shown, "clear");
  assert.equal(run([D("timeout"), D("timeout"), U("no-internet"), D("timeout")]).shown, "clear");
});

test("5 could-not-check is not down, and never clears a shown down", () => {
  const s = run([U("no-internet"), U("no-internet"), U("no-internet")]);
  assert.equal(s.shown, "unchecked");
  assert.throws(() => outsideCopy(s), { message: outsideUnchecked("no-internet") });
  assert.equal(run([U("no-internet"), U("no-internet")]).shown, "clear");
  const down = run([D("timeout"), D("timeout"), D("timeout")]);
  assert.equal(nextOutside(down, U("no-internet")).shown, "down");
  assert.equal(run([U("bad-host")]).shown, "unchecked", "bad-host shows at once");
});

test("5a only an up clears a shown row", () => {
  const u = U("no-internet");
  const d = D("timeout");
  assert.equal(run([u, u, u, d]).shown, "unchecked");
  assert.equal(run([u, u, u, d, u]).shown, "unchecked");
  assert.equal(run([u, u, u, d, d, d]).shown, "down");
  assert.equal(nextOutside(run([u, u, u]), UP).shown, "clear");
  assert.equal(run([d, d, u]).shown, "clear", "a streak still short of three shows nothing");
});

test("5b a failed outside probe is the grey row and the pending answer line, not a bad row", async () => {
  const rep = await reportFor(run([U("no-internet"), U("no-internet"), U("no-internet")]));
  const rows = homeRows(rep);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, "warn");
  assert.equal(rows[0].headline, "The Outside access check failed");
  assert.equal(rows[0].detail, outsideUnchecked("no-internet"));
  assert.deepEqual(answerFor({ report: rep, running: 3, backupAgo: null, error: false }), {
    tone: "pending",
    text: "Nothing wrong found, but the outside access check failed",
  });
});

test("5c a shown down is a bad row with the Resources link and the red answer line", async () => {
  const rep = await reportFor(run([D("edge-cant-reach-box"), D("edge-cant-reach-box"), D("edge-cant-reach-box")]));
  assert.equal(rep.hits.length, 1);
  assert.equal(rep.hits[0].severity, "bad");
  assert.deepEqual(rep.hits[0].owner, { href: "/resources", label: "Open in Resources" });
  assert.deepEqual(answerFor({ report: rep, running: 3, backupAgo: null, error: false }), {
    tone: "bad",
    text: "1 thing needs you: the site can't be reached from outside",
  });
});

test("6 blank host: the gate runs nothing and no request is made", () => {
  const { d, calls } = deps();
  let reads = 0;
  const read = (h: string) => (reads++, readOutside(h, d));
  for (const blank of [undefined, "", "   "]) assert.equal(outsideRun(blank, read), null);
  assert.equal(reads, 0);
  assert.equal(calls.resolve + calls.connect.length, 0);
  assert.notEqual(outsideRun(HOST, read), null);
  assert.match(src("lib/attention.ts"), /outsideHost \? \[\{ id: "outside"/, "the probe def is added only when a host is saved");
});

test("7 no host leaks into rows, answer or console, whatever the deps throw", async () => {
  const logs: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
    mock.method(console, k, (...a: unknown[]) => void logs.push(a.map(String).join(" "))),
  );
  try {
    const cert = Object.assign(new Error("Hostname/IP does not match certificate's altnames: Host: status.example.com"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND status.example.com"), { code: "ENOTFOUND" });
    const bad: OutsideDeps[] = [
      { resolveA: async () => { throw enotfound; }, connect: async () => edge() },
      { resolveA: async () => ({ kind: "found", addrs: ["104.16.0.1"] }), connect: async () => { throw cert; } },
    ];
    for (const d of bad) {
      const track = createOutsideTracker((h) => readOutside(h, d));
      let st = OUTSIDE_START;
      for (let i = 0; i < 3; i++) st = await track(HOST);
      const rep = await reportFor(st);
      const out = JSON.stringify(homeRows(rep)) + JSON.stringify(answerFor({ report: rep, running: 1, backupAgo: null, error: false }));
      assert.ok(!out.includes(HOST), out);
    }
    assert.ok(logs.every((l) => !l.includes(HOST)), logs.join("|"));
    assert.ok(logs.some((l) => l.includes("[outside]")), "a state change is logged by why code");
  } finally {
    for (const s of spies) s.mock.restore();
  }
});

test("8 classification table", async () => {
  const via = (a: EdgeAnswer) => readOutside(HOST, deps({ connect: async () => a }).d);
  assert.deepEqual(await readOutside(HOST, deps({ resolveA: async () => ({ kind: "nxdomain" }) }).d), D("no-dns"));
  assert.deepEqual(await readOutside(HOST, deps({ resolveA: async () => { throw new Error("x"); } }).d), U("no-internet"));
  assert.deepEqual(await via(edge({ status: 530 })), D("edge-cant-reach-box"));
  assert.deepEqual(await via(edge({ status: 502 })), D("edge-cant-reach-box"));
  assert.deepEqual(await via(edge({ status: 302, location: "https://x.cloudflareaccess.com/login" })), U("redirects-away"));
  assert.deepEqual(await via(edge({ status: 302, location: "/login" })), UP);
  assert.deepEqual(await via(edge({ status: 301, location: `https://${HOST}/home` })), UP);
  assert.deepEqual(await via(edge({ status: 302 })), U("redirects-away"), "a 3xx with no Location proves nothing");
  assert.deepEqual(await via(edge({ cacheStatus: "HIT" })), U("edge-only"));
  assert.deepEqual(await via(edge({ cacheStatus: "stale" })), U("edge-only"));
  assert.deepEqual(await via(edge({ mitigated: true, status: 403 })), U("edge-only"));
  assert.deepEqual(await via(edge()), UP);
  for (const status of [200]) assert.deepEqual(await via(edge({ status })), UP, String(status));
  for (const status of [404, 410]) assert.deepEqual(await via(edge({ status })), D("not-found"), String(status));
  for (const status of [401, 403, 418]) assert.deepEqual(await via(edge({ status })), U("refused"), String(status));
  for (const status of [500, 530]) assert.deepEqual(await via(edge({ status })), D("edge-cant-reach-box"), String(status));
  assert.deepEqual(classifyAnswer(HOST, edge({ cacheStatus: "DYNAMIC" })), UP);
  const code = (c: string) => classifyConnectError(Object.assign(new Error("secret"), { code: c }));
  for (const c of ["ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]) {
    assert.deepEqual(code(c), D("bad-certificate"), c);
  }
  for (const c of ["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ETIMEDOUT", "ABORT_ERR"]) assert.deepEqual(code(c), D("timeout"), c);
  for (const c of ["ENETUNREACH", "EAI_AGAIN", "SOMETHING_ELSE"]) assert.deepEqual(code(c), U("no-internet"), c);
  assert.deepEqual(classifyConnectError(Object.assign(new Error("t"), { name: "TimeoutError" })), D("timeout"));
  assert.deepEqual(classifyConnectError("not an error"), U("no-internet"));
});

test("8b a bad saved host reads bad-host with no network", async () => {
  const { d, calls } = deps();
  assert.deepEqual(await readOutside("https://status.example.com", d), U("bad-host"));
  assert.equal(calls.resolve + calls.connect.length, 0);
  assert.deepEqual(await readOutside("  Status.Example.COM ", d), UP, "the saved value is normalised");
});

test("9 hostnameError", () => {
  const bads = [
    "https://status.example.com", "status.example.com:443", "u@status.example.com", "status.example.com/x", "10.0.0.1",
    "localhost", "nas.local", "nas.lan", "a.home.arpa", "a.internal", "a..b.com", "-a.example.com", "a-.example.com",
    "status.example.com.", "example", "a.b.c1", "x".repeat(64) + ".com", "a.".repeat(130) + "com", "sta tus.example.com", "status.example.com?x=1",
  ];
  for (const bad of bads) {
    const m = hostnameError(bad);
    assert.ok(m, `rejects ${bad}`);
    assert.equal(m, BAD_HOST_MSG, "one fixed message, never the input");
  }
  assert.ok(hostnameError(""));
  assert.equal(hostnameError("Status.Example.com "), null);
  assert.equal(hostnameError(HOST), null);
  assert.equal(hostnameError("a-b.c-d.example.co.uk"), null);
  assert.equal(hostnameError("10.0.0.1"), BAD_HOST_MSG);
});

test("10 copy stays inside the house bounds", () => {
  const downs: DownWhy[] = ["no-dns", "private-address", "edge-cant-reach-box", "timeout", "bad-certificate", "not-found"];
  const unch: UncheckedWhy[] = ["no-internet", "not-via-cloudflare", "edge-only", "redirects-away", "bad-host", "refused"];
  for (const w of downs) {
    const c = outsideDown(w);
    assert.ok(c.headline.length <= 48 && (c.detail ?? "").length <= 140 && (c.action ?? "").length <= 70, w);
    assert.equal(c.headline, "The site can't be reached from outside");
    assert.equal(c.action, "Check the tunnel and proxy containers in Resources.");
    assert.ok(c.detail, w);
  }
  for (const w of unch) assert.ok(outsideUnchecked(w).length <= 140 && outsideUnchecked(w).length > 10, w);
  // The bounds are read from attention.ts, so a change there fails this test rather than letting clip() cut copy.
  const a = src("lib/attention.ts");
  assert.match(a, /const HEADLINE_MAX = 48;/);
  assert.match(a, /const DETAIL_MAX = 140;/);
  assert.match(a, /const ACTION_MAX = 70;/);
});

test("11 settings merge: invalid is refused, blank clears, an absent key keeps", () => {
  assert.deepEqual(mergeOutsideHost({ outsideCheckHost: "https://status.example.com" }, HOST), { error: BAD_HOST_MSG });
  assert.deepEqual(mergeOutsideHost({ outsideCheckHost: "" }, HOST), { outsideCheckHost: undefined });
  assert.deepEqual(mergeOutsideHost({ outsideCheckHost: "   " }, HOST), { outsideCheckHost: undefined });
  assert.deepEqual(mergeOutsideHost({}, HOST), { outsideCheckHost: HOST });
  assert.deepEqual(mergeOutsideHost({ outsideCheckHost: 5 }, HOST), { outsideCheckHost: HOST });
  assert.deepEqual(mergeOutsideHost({ outsideCheckHost: " Status.Example.com " }, undefined), { outsideCheckHost: HOST });
  const route = src("app/api/settings/system/route.ts");
  assert.match(route, /mergeOutsideHost\(body, existing\.outsideCheckHost\)/);
  assert.match(route, /outsideCheckHost: outside\.outsideCheckHost/);
});

test("12 the NW_OUTSIDE_FAKE hook", async () => {
  assert.equal(fakeReadings(undefined), null);
  assert.equal(fakeReadings(""), null, "compose passes an empty string when unset");
  assert.equal(fakeReadings("   "), null);
  const f = fakeReadings("down:timeout,up")!;
  assert.deepEqual([await f(), await f(), await f()], [D("timeout"), UP, UP]);
  const g = fakeReadings("bogus,down:nope,unchecked:edge-only")!;
  assert.deepEqual([await g(), await g(), await g(), await g()], [U("no-internet"), U("no-internet"), U("edge-only"), U("edge-only")]);
  let settled = false;
  void fakeReadings("hang")!().then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false, "hang never resolves");
});

test("12b unset hook uses the real deps; a set hook makes no network call; only the test compose carries it", async () => {
  const { d, calls } = deps();
  assert.deepEqual(await pickReader(undefined, d)(HOST), UP);
  assert.equal(calls.resolve, 1);
  assert.deepEqual(await pickReader("", d)(HOST), UP);
  assert.equal(calls.resolve, 2);
  assert.deepEqual(await pickReader("down:timeout", d)(HOST), D("timeout"));
  assert.equal(calls.resolve, 2);
  assert.equal(calls.connect.length, 2);
  assert.ok(!src("../docker-compose.yml").includes("NW_OUTSIDE_FAKE"), "production compose never sets the hook");
  assert.match(src("../docker-compose.test.yml"), /NW_OUTSIDE_FAKE(?:: |=)\$\{NW_OUTSIDE_FAKE:-\}/);
  assert.match(src("lib/attention.ts"), /pickReader\(process\.env\.NW_OUTSIDE_FAKE, realDeps\)/);
});

test("23 a changed host resets the streak", async () => {
  const track = createOutsideTracker(async () => D("timeout"));
  await track(HOST);
  await track(HOST);
  assert.equal((await track(HOST)).shown, "down");
  assert.equal((await track("other.example.com")).shown, "clear");
});

test("13 realDeps.connect pins port, agent, lookup and a timeout signal", async () => {
  let opts: Record<string, unknown> = {};
  const spy = mock.method(https, "request", ((o: Record<string, unknown>, cb: (res: unknown) => void) => {
    opts = o;
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => cb({ statusCode: 200, headers: { "cf-ray": "abc" }, destroy() {} });
    return req;
  }) as never);
  try {
    assert.deepEqual(await realDeps.connect(HOST, "104.16.0.1"), { status: 200, location: undefined, cfRay: true, cacheStatus: undefined, mitigated: false });
  } finally {
    spy.mock.restore();
  }
  assert.equal(opts.port, 443);
  assert.equal(opts.agent, false);
  assert.equal(opts.servername, HOST);
  assert.ok(opts.signal instanceof AbortSignal);
  let got: unknown[] = [];
  (opts.lookup as (h: string, o: object, cb: (...a: unknown[]) => void) => void)(HOST, {}, (...a) => (got = a));
  assert.deepEqual(got, [null, "104.16.0.1", 4], "the connection is pinned to the checked address");
});

test("14 realDeps.resolveA reads DoH defensively", async () => {
  const answer = (body: string, status = 200) => {
    const spy = mock.method(globalThis, "fetch", (async () => new Response(body, { status })) as never);
    return { spy, done: () => spy.mock.restore() };
  };
  const ask = async (body: string, status = 200) => {
    const a = answer(body, status);
    try {
      return await realDeps.resolveA(HOST);
    } finally {
      a.done();
    }
  };
  await assert.rejects(ask(JSON.stringify({ Status: 0, pad: "x".repeat(9_000) })), /too large/);
  await assert.rejects(ask("{}", 500), /resolver/);
  assert.deepEqual(await ask(JSON.stringify({ Status: 3 })), { kind: "nxdomain" });
  assert.deepEqual(await ask(JSON.stringify({ Status: 0, Answer: [{ type: 5, data: "other.example.com." }] })), { kind: "nxdomain" });
  assert.deepEqual(
    await ask(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "not-an-ip" }, { type: 1, data: "::1" }, { type: 1, data: "104.16.0.1" }, { type: 1 }] })),
    { kind: "found", addrs: ["104.16.0.1"] },
  );
});

test("15 an env-only host turns the badge on without sending the value to the browser", () => {
  const settings = src("app/api/settings/route.ts");
  assert.equal(settings.split('outsideCheckConfigured: Boolean(systemSetting("outsideCheckHost", "OUTSIDE_CHECK_HOST")?.trim())').length - 1, 2, "a boolean in both meta blocks");
  assert.ok(!/OUTSIDE_CHECK_HOST"\)(?!\?\.trim\(\)\))/.test(settings), "the env value is only ever wrapped in Boolean()");
  const ui = src("components/settings/settings-access.tsx");
  assert.match(ui, /data\?\.meta\.outsideCheckConfigured \|\| data\?\.config\.system\?\.outsideCheckHost/);
  assert.match(ui, /Set by OUTSIDE_CHECK_HOST on the server\./);
});

test("wiring: the field is plain text, travels in publicSystem, and the probe id exists", () => {
  assert.match(src("lib/orchestra-settings.ts"), /outsideCheckHost: system\.outsideCheckHost/);
  assert.match(src("lib/config.ts"), /outsideCheckHost\?: string/);
  assert.match(src("lib/attention-report.ts"), /case "outside":/);
});
