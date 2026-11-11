import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFrameCache, deskCameraResponse, doorCameraEntity, FRAME_CAP, type UpstreamFetch } from "./desk-camera.ts";
import { isDeskCameraPath } from "./desk-auth.ts";

const TOKEN = "d".repeat(40);
const MCP = "m".repeat(40);
const AUTH = `Bearer ${TOKEN}`;
const jpeg = (bytes = 100, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", ...headers } });

function setup(upstream: UpstreamFetch, over: Partial<Parameters<typeof deskCameraResponse>[0]> = {}) {
  let t = 1_000;
  const clock = { advance: (ms: number) => (t += ms) };
  const cache = createFrameCache(upstream, () => t);
  const call = (o: Partial<Parameters<typeof deskCameraResponse>[0]> = {}) =>
    deskCameraResponse({
      deskToken: TOKEN,
      mcpToken: MCP,
      authorization: AUTH,
      flag: () => true,
      resolve: async () => "camera.front_door",
      cache,
      ...over,
      ...o,
    });
  return { call, clock };
}
const bodyText = (r: { body: Uint8Array | string | null }) => (r.body == null ? "" : typeof r.body === "string" ? r.body : Buffer.from(r.body).toString());

test("200 carries the frame, the validated type, no-store and nosniff", async () => {
  const { call } = setup(async () => jpeg(100));
  const r = await call();
  assert.equal(r.status, 200);
  assert.equal(r.headers["Content-Type"], "image/jpeg");
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal(r.headers["X-Content-Type-Options"], "nosniff");
  assert.equal((r.body as Uint8Array).length, 100);
});

test("image/png is forwarded as png; anything else is 502", async () => {
  const png = setup(async () => new Response(new Uint8Array(5), { headers: { "content-type": "image/png" } }));
  assert.equal((await png.call()).headers["Content-Type"], "image/png");
  for (const type of ["text/html", "image/svg+xml", ""]) {
    const { call } = setup(async () => new Response(new Uint8Array(5), { headers: type ? { "content-type": type } : {} }));
    const r = await call();
    assert.equal(r.status, 502, type);
    assert.equal(bodyText(r), "");
  }
});

test("503 is byte-identical between desk-off and flag-off, and flag-off needs a valid bearer to be reached", async () => {
  const { call } = setup(async () => jpeg());
  const deskOff = await call({ deskToken: undefined });
  const flagOff = await call({ flag: () => false });
  assert.equal(deskOff.status, 503);
  assert.deepEqual(flagOff, deskOff);
  assert.equal(bodyText(deskOff), JSON.stringify({ error: "Desk access is not turned on." }));
  assert.equal(deskOff.headers["Cache-Control"], "no-store");
  // equal to the MCP token also counts as desk-off
  assert.equal((await call({ deskToken: MCP, mcpToken: MCP })).status, 503);
});

test("401 for a missing, wrong or wrong-length bearer, in both flag states, with an empty body", async () => {
  const { call } = setup(async () => jpeg());
  for (const flag of [true, false]) {
    for (const authorization of [null, "", "Bearer nope", `Bearer ${"x".repeat(40)}`, `Bearer ${TOKEN}extra`, TOKEN]) {
      const r = await call({ flag: () => flag, authorization });
      assert.equal(r.status, 401, `${flag} ${authorization}`);
      assert.equal(bodyText(r), "");
    }
  }
});

test("an unresolved or indoor camera is an empty 404 and never reaches the upstream", async () => {
  let calls = 0;
  const { call } = setup(async () => (calls++, jpeg()));
  const r = await call({ resolve: async () => null });
  assert.equal(r.status, 404);
  assert.equal(bodyText(r), "");
  assert.equal(calls, 0);
});

test("a resolver that throws is an empty 502", async () => {
  const { call } = setup(async () => jpeg());
  const r = await call({ resolve: async () => { throw new Error("secret HA detail"); } });
  assert.equal(r.status, 502);
  assert.equal(bodyText(r), "");
});

test("doorCameraEntity: the pinned view camera, else the first door camera, else null; ?entity has no way in", () => {
  const cams = [{ entityId: "camera.front_door" }, { entityId: "camera.side_door" }];
  assert.equal(doorCameraEntity({ status: "ok", cameras: cams, viewCamera: "camera.side_door" }), "camera.side_door");
  assert.equal(doorCameraEntity({ status: "ok", cameras: cams, viewCamera: null }), "camera.front_door");
  assert.equal(doorCameraEntity({ status: "ok", cameras: [], viewCamera: null }), null);
  assert.equal(doorCameraEntity({ status: "unreachable", cameras: cams, viewCamera: null }), null);
  // deskCameraResponse takes no url, query or entity input at all
  assert.equal(deskCameraResponse.length, 1);
});

test("a 2 MiB upstream with no content-length is 502 and nothing is cached", async () => {
  let calls = 0;
  const big = () => {
    let sent = 0;
    return new Response(
      new ReadableStream({
        pull(c) {
          if (sent >= 2 * 1024 * 1024) return c.close();
          sent += 64 * 1024;
          c.enqueue(new Uint8Array(64 * 1024));
        },
      }),
      { headers: { "content-type": "image/jpeg" } },
    );
  };
  const { call } = setup(async () => (calls++, big()));
  const r = await call();
  assert.equal(r.status, 502);
  assert.equal(bodyText(r), "");
  // the failure is cached for 5 s but is never a success
  assert.equal((await call()).status, 502);
  assert.equal(calls, 1);
});

test("a content-length over the cap is rejected before reading", async () => {
  const { call } = setup(async () => jpeg(10, { "content-length": String(FRAME_CAP + 1) }));
  assert.equal((await call()).status, 502);
});

test("exactly the cap is accepted", async () => {
  const { call } = setup(async () => jpeg(FRAME_CAP));
  assert.equal((await call()).status, 200);
});

test("concurrent callers share one fetch, and its signal is its own and still live", async () => {
  let calls = 0;
  let seen: AbortSignal | undefined;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { call } = setup(async (_e, signal) => {
    calls++;
    seen = signal;
    await gate;
    return jpeg(10);
  });
  const first = call();
  const second = call();
  await new Promise((r) => setTimeout(r, 5)); // let the resolver and the fetch start
  assert.equal(seen?.aborted, false);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(calls, 1);
});

test("a frame is served from cache for 5 s, then refetched", async () => {
  let calls = 0;
  const { call, clock } = setup(async () => (calls++, jpeg(10)));
  await call();
  clock.advance(4_000);
  await call();
  assert.equal(calls, 1);
  clock.advance(1_500);
  await call();
  assert.equal(calls, 2);
});

test("two calls in a row after a failure make one upstream call", async () => {
  let calls = 0;
  const { call } = setup(async () => (calls++, { error: "HA said camera.front_door tok_secret", status: 502 }));
  const a = await call();
  const b = await call();
  assert.equal(a.status, 502);
  assert.equal(b.status, 502);
  assert.equal(bodyText(a), "");
  assert.equal(calls, 1);
});

test("an upstream that never resolves is cut off by the fetch's own timeout: an empty 502, cached as a failure", { timeout: 5000 }, async () => {
  let calls = 0;
  const t = 1_000;
  const cache = createFrameCache((_e, signal) => {
    calls++;
    return new Promise((_r, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
  }, () => t, 20);
  const call = () => deskCameraResponse({ deskToken: TOKEN, mcpToken: MCP, authorization: AUTH, flag: () => true, resolve: async () => "camera.front_door", cache });
  const r = await call();
  assert.equal(r.status, 502);
  assert.equal(bodyText(r), "");
  await call();
  assert.equal(calls, 1);
});

test("a flag that throws is never called for a bad bearer", async () => {
  const { call } = setup(async () => jpeg());
  const r = await call({ flag: () => { throw new Error("corrupt config"); }, authorization: "Bearer nope" });
  assert.equal(r.status, 401);
});

test("an upstream that throws is an empty 502", async () => {
  const { call } = setup(async () => { throw new Error("boom http://ha.example tok"); });
  const r = await call();
  assert.equal(r.status, 502);
  assert.equal(bodyText(r), "");
});

test("after a cached frame, a resolver that now returns no camera is 404", async () => {
  const { call } = setup(async () => jpeg(10));
  assert.equal((await call()).status, 200);
  assert.equal((await call({ resolve: async () => null })).status, 404);
});

test("the cache is keyed by entity", async () => {
  const seen: string[] = [];
  const { call } = setup(async (e) => (seen.push(e), jpeg(10)));
  await call();
  await call({ resolve: async () => "camera.side_door" });
  assert.deepEqual(seen, ["camera.front_door", "camera.side_door"]);
});

// The route and middleware load @/ aliases, so they are pinned as source.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
test("middleware: exact camera path, before the cross-site and public-path checks", () => {
  assert.equal(isDeskCameraPath("/api/desk/camera"), true);
  for (const p of ["/api/desk/camera/", "/api/desk/camera2", "/api/desk/%63amera", "/api/desk/", "/api/desk/glance"]) {
    assert.equal(isDeskCameraPath(p), false, p);
  }
  const mw = read("../middleware.ts");
  assert.match(mw, /^\s+if \(isDeskCameraPath\(pathname\)\) return NextResponse\.next\(\);/m);
  assert.ok(mw.indexOf("isDeskCameraPath(pathname)") < mw.indexOf("crossSiteWriteRefused(req.method"));
  assert.doesNotMatch(/const PUBLIC_PATHS = \[([^\]]*)\]/.exec(mw)?.[1] ?? "", /desk/);
});

test("route: GET and dynamic only, delegates to the lib, no query or entity input, never reads upstream errors", () => {
  const route = read("../app/api/desk/camera/route.ts");
  const exported = [...route.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "dynamic"]);
  assert.match(route, /deskCameraResponse\(/);
  assert.match(route, /loadConfig\(\)\.system\?\.deskCamera === true/);
  assert.doesNotMatch(route, /searchParams|nextUrl|new URL|req\.url|req\.signal/);
  assert.doesNotMatch(route, /\.error\b/);
  assert.match(route, /catch/);
});
