import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

// briefing.ts imports "@/lib/..." which plain node cannot resolve; map it for this process only.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  if (/^\\.\\.?\\/[^.?]*$/.test(s)) return next(s + ".ts", c); // briefing.ts imports "./read-capped" with no extension
  return next(s, c);
}`));

type Briefing = typeof import("./briefing.ts");
type Up = "ok" | "down" | "empty";

const ENV = ["DATA_DIR", "HERMES_API_URL", "HERMES_API_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realNow = Date.now;
const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);
const MIN = 60_000;
let dir = "";
let n = 0;
let clock = T0;
// What each upstream answers, and how often it was asked.
let digestUp: Up;
let feedUp: Up;
let calls: { activity: number; feed: number; run: number };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rss = (titles: string[]) => `<rss><channel>${titles.map((t) => `<item><title>${t}</title></item>`).join("")}</channel></rss>`;

function stubFetch() {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("http://feed.test")) {
      calls.feed++;
      if (feedUp === "down") throw new Error("feed down");
      return new Response(rss(feedUp === "ok" ? ["Headline one", "Headline two"] : []), { status: 200 });
    }
    if (u.includes("/activity")) {
      calls.activity++;
      if (digestUp === "down") throw new Error("hermes down");
      const items = digestUp === "ok" ? [{ at: "2026-11-19T01:00:00Z", kind: "digest", title: "Digest", body: "All quiet\nDetails" }] : [];
      return json(200, { items });
    }
    if (init?.method === "POST") {
      calls.run++;
      return json(202, { jobId: "job:1" });
    }
    return json(200, { state: "done", kind: "summarize", result: { body: "- summary" } });
  }) as typeof fetch;
}

/** A fresh copy of the module (its own day state) over an emptied Memo slot, so test order does not matter. */
async function freshBriefing(): Promise<Briefing> {
  (globalThis as unknown as { __memoStore?: Map<string, unknown> }).__memoStore?.delete("briefing.daily");
  return (await import(`./briefing.ts?t=${++n}`)) as Briefing;
}

async function at(b: Briefing, t: number) {
  clock = t;
  const r = await b.getBriefing();
  assert.equal(r.status, "ok");
  return r as import("./briefing.ts").BriefingOk;
}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "briefing-"));
  process.env.DATA_DIR = dir;
  process.env.HERMES_API_URL = "http://hermes.test:8765/";
  process.env.HERMES_API_TOKEN = "test-only-hermes-token";
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ display: { timezone: "UTC", newsFeeds: ["http://feed.test/rss"] } }));
  digestUp = "ok";
  feedUp = "ok";
  calls = { activity: 0, feed: 0, run: 0 };
  clock = T0;
  Date.now = () => clock;
  stubFetch();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a failed half is retried after the floor", () => {
  it("A: both failed at T0 are cached inside 5 min with no upstream call, then both refetched", async () => {
    const b = await freshBriefing();
    digestUp = "down";
    feedUp = "down";
    const first = await at(b, T0);
    assert.equal(first.digest, undefined);
    assert.equal(first.news, undefined);
    const asked = { ...calls };

    const inside = await at(b, T0 + 4 * MIN);
    assert.equal(inside.digest, undefined);
    assert.deepEqual(calls, asked, "no upstream call inside the floor");

    digestUp = "ok";
    feedUp = "ok";
    const after = await at(b, T0 + 5 * MIN + 1000);
    assert.equal(after.digest?.headline, "All quiet");
    assert.deepEqual(after.news?.headlines, ["Headline one", "Headline two"]);
  });

  it("B: only news is refetched, and the digest survives, even when the news retry fails again", async () => {
    const b = await freshBriefing();
    feedUp = "down";
    const first = await at(b, T0);
    assert.equal(first.digest?.headline, "All quiet");
    assert.equal(first.news, undefined);
    assert.equal(calls.activity, 1);

    const retry = await at(b, T0 + 5 * MIN + 1000);
    assert.equal(calls.activity, 1, "digest not refetched");
    assert.equal(calls.feed, 2, "news refetched");
    assert.equal(retry.digest?.headline, "All quiet", "digest kept when the retry fails again");
    assert.equal(retry.news, undefined);

    feedUp = "ok";
    const healed = await at(b, T0 + 11 * MIN);
    assert.equal(calls.activity, 1);
    assert.equal(healed.digest?.headline, "All quiet");
    assert.equal(healed.news?.headlines.length, 2);
  });

  it("C: only the digest is refetched and the summarize job is not started again", async () => {
    const b = await freshBriefing();
    digestUp = "down";
    const first = await at(b, T0);
    assert.equal(first.digest, undefined);
    assert.equal(first.news?.headlines.length, 2);
    assert.equal(calls.run, 1);

    digestUp = "ok";
    const retry = await at(b, T0 + 5 * MIN + 1000);
    assert.equal(retry.digest?.headline, "All quiet");
    assert.equal(retry.news?.headlines.length, 2, "news kept");
    assert.equal(calls.run, 1, "no second summarize job");
    assert.equal(calls.feed, 1, "feeds not refetched");
  });

  it("D: an answered-empty digest and empty feeds are cached for the day, not retried", async () => {
    const b = await freshBriefing();
    digestUp = "empty";
    feedUp = "empty";
    const first = await at(b, T0);
    assert.equal(first.digest, undefined);
    assert.equal(first.news, undefined);
    assert.ok(calls.activity === 1 && calls.feed === 1);
    const asked = { ...calls };

    await at(b, T0 + 10 * MIN);
    assert.deepEqual(calls, asked);
  });

  it("E: a retry that fails again starts a new floor", async () => {
    const b = await freshBriefing();
    digestUp = "down";
    feedUp = "down";
    await at(b, T0);
    const retryAt = T0 + 5 * MIN + 1000;
    await at(b, retryAt);
    assert.equal(calls.activity, 2, "the retry asked again");
    const asked = { ...calls };

    await at(b, retryAt + 4 * MIN);
    assert.deepEqual(calls, asked, "inside the new floor");
    await at(b, retryAt + 5 * MIN + 1000);
    assert.equal(calls.activity, 3);
    assert.equal(calls.feed, 3);
  });

  it("F: a date roll after a failure loads both halves fresh", async () => {
    const b = await freshBriefing();
    feedUp = "down";
    const first = await at(b, T0);
    assert.equal(first.news, undefined);

    feedUp = "ok";
    const next = await at(b, T0 + 13 * MIN * 60); // 01:00 UTC the next day
    assert.notEqual(next.date, first.date);
    assert.equal(calls.activity, 2, "digest refetched on the new day");
    assert.equal(next.news?.headlines.length, 2);
  });

  it("F2: a date roll inside the floor still reloads both halves", async () => {
    const b = await freshBriefing();
    clock = Date.UTC(2026, 10, 19, 23, 58, 0);
    feedUp = "down";
    const first = await at(b, clock);
    feedUp = "ok";
    const next = await at(b, Date.UTC(2026, 10, 20, 0, 1, 0)); // 3 min later, after midnight
    assert.notEqual(next.date, first.date);
    assert.equal(calls.activity, 2);
    assert.equal(next.news?.headlines.length, 2);
  });
});
