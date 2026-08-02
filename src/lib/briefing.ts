import { loadConfig } from "@/lib/config";
import { getHermesActivity, getHermesJob, runHermesJob } from "@/lib/hermes-ctl";
import type { HermesActivityItem } from "@/lib/hermes-types";

/**
 * Server-only "morning briefing" assembler for the public /kiosk display:
 * the Hermes daemon's latest overnight digest plus an LLM-written summary of
 * today's top headlines. Unlike weather.ts and ha.ts, a missing upstream here
 * is NOT a failure of the whole briefing — digest and news are each optional
 * and independently degrade to `undefined` (see fetchDigest/fetchNews), so a
 * dead Hermes daemon or an unreachable RSS host never turns into a 500 for
 * the kiosk card. Only a genuinely unconfigured install (no `display` block,
 * hence no timezone to key the daily cache on) short-circuits with a problem
 * status.
 */

const FEED_TIMEOUT_MS = 6000;
const ASK_POLL_INTERVAL_MS = 2000;
const ASK_CEILING_MS = 45000;
const MAX_HEADLINES_CONSIDERED = 8;
const MAX_HEADLINES_SHOWN = 4;

export interface BriefingDigest {
  headline: string;
  body: string;
  actionNeeded?: string;
}

export interface BriefingNews {
  /** LLM-written 3-bullet summary of the top headlines. Absent whenever
   *  Hermes couldn't produce one (unreachable, job failed, or timed out) —
   *  the card falls back to rendering `headlines` raw. */
  summary?: string;
  headlines: string[];
  source: string;
}

export interface BriefingOk {
  status: "ok";
  /** Local date (YYYY-MM-DD) in config.display.timezone — also the cache key. */
  date: string;
  digest?: BriefingDigest;
  news?: BriefingNews;
}

export interface BriefingProblem {
  status: "unconfigured";
  date: string;
  detail: string;
}

export type BriefingResponse = BriefingOk | BriefingProblem;

export const BRIEFING_UNCONFIGURED_DETAIL =
  'No display config. Add a "display" block (with a "timezone") to data/config.json on the ' +
  'server: { "display": { "timezone": "<IANA tz>", "newsFeeds": ["<rss url>"] } }';

interface BriefingConfig {
  timezone: string;
  newsFeeds: string[];
}

function briefingConfig(): BriefingConfig | null {
  const d = loadConfig().display;
  if (!d || !d.timezone) return null;
  return {
    timezone: d.timezone,
    newsFeeds: Array.isArray(d.newsFeeds) ? d.newsFeeds.filter((u): u is string => typeof u === "string" && !!u) : [],
  };
}

/** en-CA formats as YYYY-MM-DD directly — no manual zero-padding/reassembly. */
function localDateString(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- digest: most recent "digest" activity item ------------------------------

/** First line = headline. The last line starting "Action needed:" (if any)
 *  is pulled out separately; everything else becomes body. Falls back to the
 *  activity item's title when body text is empty — the daemon is being built
 *  in parallel against this same contract, so an empty/odd body must degrade
 *  rather than produce an empty card. */
function extractDigest(item: HermesActivityItem): BriefingDigest {
  const text = (item.body || item.title || "").trim();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headline: item.title || "Overnight digest", body: "" };

  const headline = lines[0];
  let actionNeeded: string | undefined;
  for (let i = lines.length - 1; i >= 1; i--) {
    const m = /^Action needed:\s*(.*)$/i.exec(lines[i]);
    if (m) {
      actionNeeded = m[1].trim() || undefined;
      lines.splice(i, 1);
      break;
    }
  }
  const body = lines.slice(1).join(" ").trim();
  return { headline, body, actionNeeded };
}

async function fetchDigest(): Promise<BriefingDigest | null> {
  const activity = await getHermesActivity(20);
  if (activity.status !== "ok") return null;

  const digestItems = activity.items.filter((i) => i.kind === "digest");
  if (digestItems.length === 0) return null;
  digestItems.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return extractDigest(digestItems[0]);
}

// --- news: RSS titles + Hermes-summarized headline ---------------------------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&#039;": "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&amp;|&quot;|&apos;|&lt;|&gt;|&#039;/g, (m) => ENTITIES[m]);
}

/** Deliberately not a real XML parser — no new dependency, and RSS <title>
 *  extraction is regular enough that a scoped-to-<item> regex is reliable in
 *  practice. Titles are commonly CDATA-wrapped; unwrap before entity-decoding. */
function extractTitles(xml: string): string[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const titles: string[] = [];
  for (const item of items) {
    const m = /<title>([\s\S]*?)<\/title>/i.exec(item);
    if (!m) continue;
    let t = m[1].trim();
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(t);
    if (cdata) t = cdata[1].trim();
    t = decodeEntities(t).trim();
    if (t) titles.push(t);
  }
  return titles;
}

async function fetchFeedTitles(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return [];
    return extractTitles(await res.text());
  } catch {
    // One dead feed must not sink the others — swallow and contribute nothing.
    return [];
  }
}

/** Case-insensitive de-dupe across every configured feed, stopping as soon as
 *  MAX_HEADLINES_CONSIDERED unique titles are found (feed order = config
 *  order), so "top 8 overall" doesn't require waiting on every feed to know
 *  it can stop collecting. */
async function collectHeadlines(feeds: string[]): Promise<string[]> {
  const perFeed = await Promise.all(feeds.map(fetchFeedTitles));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const titles of perFeed) {
    for (const title of titles) {
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(title);
      if (out.length >= MAX_HEADLINES_CONSIDERED) return out;
    }
  }
  return out;
}

function sourceLabel(feeds: string[]): string {
  const hosts = new Set<string>();
  for (const url of feeds) {
    try {
      hosts.add(new URL(url).hostname.replace(/^www\./, ""));
    } catch {
      // malformed feed URL — excluded from the label rather than shown raw
    }
  }
  return hosts.size ? Array.from(hosts).join(", ") : "News";
}

/** Runs the "summarize" job and polls to completion/failure/ceiling. NOT the
 *  "ask" kind: ask carries the ops persona, whose "only report facts from
 *  nightwatch tools" rule makes it refuse non-telemetry text — it literally
 *  declined to summarize headlines when this first shipped. "summarize" is
 *  Hermes's neutral tool-free compression role. Every failure mode (Hermes
 *  unconfigured/unreachable, job errors, 45s ceiling reached) returns
 *  undefined rather than throwing — the caller's job is to degrade to raw
 *  headlines, never to fail the whole briefing over a slow LLM. */
async function summarizeHeadlines(headlines: string[]): Promise<string | undefined> {
  const question =
    'In 3 short plain-text bullet lines ("- " prefixed, no preamble), summarize the most ' +
    `important of these news headlines: ${headlines.join("; ")}`;

  const run = await runHermesJob("summarize", question);
  if (!run.ok) return undefined;

  const deadline = Date.now() + ASK_CEILING_MS;
  while (Date.now() < deadline) {
    const jobRes = await getHermesJob(run.jobId);
    if (!jobRes.ok) return undefined;
    const { job } = jobRes;
    if (job.state === "done") {
      const text = job.result?.body?.trim() || job.result?.title?.trim();
      return text || undefined;
    }
    if (job.state === "error") return undefined;
    await sleep(ASK_POLL_INTERVAL_MS);
  }
  return undefined;
}

async function fetchNews(cfg: BriefingConfig): Promise<BriefingNews | null> {
  if (cfg.newsFeeds.length === 0) return null;
  const headlines = await collectHeadlines(cfg.newsFeeds);
  if (headlines.length === 0) return null;

  const summary = await summarizeHeadlines(headlines);
  return { summary, headlines: headlines.slice(0, MAX_HEADLINES_SHOWN), source: sourceLabel(cfg.newsFeeds) };
}

// --- assembly, daily cache + in-flight guard ---------------------------------

let cached: { date: string; data: BriefingOk } | null = null;
let inflight: { date: string; promise: Promise<BriefingOk> } | null = null;

async function assembleBriefing(cfg: BriefingConfig, date: string): Promise<BriefingOk> {
  const [digest, news] = await Promise.all([
    fetchDigest().catch(() => null),
    fetchNews(cfg).catch(() => null),
  ]);
  return { status: "ok", date, digest: digest ?? undefined, news: news ?? undefined };
}

/**
 * One assembled briefing per local calendar day: the news summary is the
 * expensive part (an LLM round-trip), so the first kiosk request of the day
 * pays for it and every request afterward — including a second kiosk tab
 * racing the first one, via the in-flight promise reuse below — reads the
 * cached result instead of triggering another Hermes job.
 */
export async function getBriefing(): Promise<BriefingResponse> {
  const cfg = briefingConfig();
  if (!cfg) {
    return { status: "unconfigured", date: new Date().toISOString().slice(0, 10), detail: BRIEFING_UNCONFIGURED_DETAIL };
  }

  const date = localDateString(cfg.timezone);
  if (cached && cached.date === date) return cached.data;
  if (inflight && inflight.date === date) return inflight.promise;

  const promise = assembleBriefing(cfg, date).then(
    (data) => {
      cached = { date, data };
      inflight = null;
      return data;
    },
    (err) => {
      // Defensive only — assembleBriefing's own fetchDigest/fetchNews calls
      // already catch their failures internally. Guarantees the in-flight
      // guard can't wedge a whole day's requests behind one unexpected throw.
      inflight = null;
      throw err;
    },
  );
  inflight = { date, promise };
  return promise;
}
