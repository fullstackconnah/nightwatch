import { loadConfig, type WidgetInstance } from "@/lib/config";
import { formatBytes, formatNumber, formatPercent } from "@/lib/format";
import type { KioskDownloadItem, KioskDownloadsResult } from "@/lib/downloads-types";
import { resolvePath } from "./jsonpath";
import { fetchJson, postAction, WidgetError, type WidgetFetcher, type WidgetField } from "./types";

/**
 * Built-in widget fetchers for what actually runs on the homelab today.
 * Each returns display-ready fields; auth/session handling stays server-side.
 */

// --- *arr family ------------------------------------------------------------

const sonarr: WidgetFetcher = async (w) => {
  const h = { "X-Api-Key": w.key || "" };
  const [wanted, queue, series] = await Promise.all([
    fetchJson<{ totalRecords: number }>(`${w.url}/api/v3/wanted/missing?pageSize=1`, { headers: h }),
    fetchJson<{ totalRecords: number }>(`${w.url}/api/v3/queue?pageSize=1`, { headers: h }),
    fetchJson<{ statistics?: { episodeFileCount?: number } }[]>(`${w.url}/api/v3/series`, { headers: h }),
  ]);
  const episodes = series.reduce((a, s) => a + (s.statistics?.episodeFileCount ?? 0), 0);
  return [
    { label: "Series", value: formatNumber(series.length) },
    { label: "Episodes", value: formatNumber(episodes) },
    { label: "Wanted", value: formatNumber(wanted.totalRecords), intent: wanted.totalRecords > 0 ? "warn" : undefined },
    { label: "Queued", value: formatNumber(queue.totalRecords) },
  ];
};

const radarr: WidgetFetcher = async (w) => {
  const h = { "X-Api-Key": w.key || "" };
  const [movies, queue] = await Promise.all([
    fetchJson<{ monitored: boolean; hasFile: boolean }[]>(`${w.url}/api/v3/movie`, { headers: h }),
    fetchJson<{ totalRecords: number }>(`${w.url}/api/v3/queue?pageSize=1`, { headers: h }),
  ]);
  const missing = movies.filter((m) => m.monitored && !m.hasFile).length;
  return [
    { label: "Movies", value: formatNumber(movies.length) },
    { label: "Missing", value: formatNumber(missing), intent: missing > 0 ? "warn" : undefined },
    { label: "Queued", value: formatNumber(queue.totalRecords) },
  ];
};

/** Shared *arr command trigger (G3 widget actions) — same POST /command endpoint
 *  both Sonarr and Radarr expose; only the command name differs by caller. */
export async function arrCommand(w: WidgetInstance, name: string): Promise<void> {
  await postAction(`${w.url}/api/v3/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": w.key || "" },
    body: JSON.stringify({ name }),
  });
}

const prowlarr: WidgetFetcher = async (w) => {
  const stats = await fetchJson<{
    indexers: { numberOfGrabs: number; numberOfQueries: number; numberOfFailedQueries: number }[];
  }>(`${w.url}/api/v1/indexerstats`, { headers: { "X-Api-Key": w.key || "" } });
  const sum = (f: (i: { numberOfGrabs: number; numberOfQueries: number; numberOfFailedQueries: number }) => number) =>
    stats.indexers.reduce((a, i) => a + f(i), 0);
  const fails = sum((i) => i.numberOfFailedQueries);
  return [
    { label: "Grabs", value: formatNumber(sum((i) => i.numberOfGrabs)) },
    { label: "Queries", value: formatNumber(sum((i) => i.numberOfQueries)) },
    { label: "Failed", value: formatNumber(fails), intent: fails > 0 ? "warn" : undefined },
  ];
};

const bazarr: WidgetFetcher = async (w) => {
  const badges = await fetchJson<{ episodes: number; movies: number }>(`${w.url}/api/badges`, {
    headers: { "X-API-KEY": w.key || "" },
  });
  return [
    { label: "Missing ep subs", value: formatNumber(badges.episodes), intent: badges.episodes > 0 ? "warn" : undefined },
    { label: "Missing movie subs", value: formatNumber(badges.movies), intent: badges.movies > 0 ? "warn" : undefined },
  ];
};

// --- qBittorrent (cookie session) -------------------------------------------

const qbitSessions = new Map<string, { cookie: string; ts: number }>();

async function qbitLogin(w: WidgetInstance): Promise<string> {
  const cached = qbitSessions.get(w.url);
  if (cached && Date.now() - cached.ts < 25 * 60 * 1000) return cached.cookie;
  let res: Response;
  try {
    // qBittorrent's CSRF protection rejects logins without a matching Referer/Origin.
    res = await fetch(`${w.url}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: w.url,
        Origin: w.url,
      },
      body: `username=${encodeURIComponent(w.username || "")}&password=${encodeURIComponent(w.password || "")}`,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
  } catch {
    throw new WidgetError("unreachable");
  }
  const cookie = res.headers.get("set-cookie")?.match(/SID=[^;]+/)?.[0];
  if (!res.ok || !cookie) throw new WidgetError("login failed");
  qbitSessions.set(w.url, { cookie, ts: Date.now() });
  return cookie;
}

const qbittorrent: WidgetFetcher = async (w) => {
  // qBittorrent may whitelist docker subnets (AuthSubnetWhitelistEnabled) —
  // try unauthenticated first, log in only when the API demands it.
  const run = async (cookie?: string) => {
    const h: Record<string, string> = { Referer: w.url, Origin: w.url };
    if (cookie) h.Cookie = cookie;
    const [transfer, torrents] = await Promise.all([
      fetchJson<{ dl_info_speed: number; up_info_speed: number }>(`${w.url}/api/v2/transfer/info`, { headers: h }),
      fetchJson<{ state: string }[]>(`${w.url}/api/v2/torrents/info`, { headers: h }),
    ]);
    const leeching = torrents.filter((t) => t.state.toLowerCase().includes("dl")).length;
    const seeding = torrents.filter((t) => t.state.toLowerCase().includes("up")).length;
    return [
      { label: "Down", value: `${formatBytes(transfer.dl_info_speed)}/s`, intent: transfer.dl_info_speed > 0 ? ("ok" as const) : undefined },
      { label: "Up", value: `${formatBytes(transfer.up_info_speed)}/s` },
      { label: "Leeching", value: formatNumber(leeching) },
      { label: "Seeding", value: formatNumber(seeding) },
    ];
  };
  try {
    return await run(qbitSessions.get(w.url)?.cookie);
  } catch (e) {
    if (e instanceof WidgetError && e.message.startsWith("HTTP 40")) {
      qbitSessions.delete(w.url); // unauthenticated/stale — log in and retry once
      return run(await qbitLogin(w));
    }
    throw e;
  }
};

/** Pause/resume every torrent (G3 widget actions) — same login-and-retry-once
 *  shape as the qbittorrent fetcher above, since these endpoints demand the
 *  session cookie even when the read-only stats calls don't. */
export async function qbitSetPaused(w: WidgetInstance, paused: boolean): Promise<void> {
  const endpoint = paused ? "pause" : "resume";
  const attempt = async (cookie?: string) => {
    const h: Record<string, string> = {
      Referer: w.url,
      Origin: w.url,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (cookie) h.Cookie = cookie;
    await postAction(`${w.url}/api/v2/torrents/${endpoint}`, { method: "POST", headers: h, body: "hashes=all" });
  };
  try {
    await attempt(qbitSessions.get(w.url)?.cookie);
  } catch (e) {
    if (e instanceof WidgetError && e.message.startsWith("HTTP 40")) {
      qbitSessions.delete(w.url);
      await attempt(await qbitLogin(w));
      return;
    }
    throw e;
  }
}

// --- qBittorrent downloads (kiosk tray) --------------------------------------

interface QbitDownloadingTorrent {
  hash: string;
  name: string;
  progress: number;
  dlspeed: number;
  size: number;
  eta: number;
}

/** qBittorrent's own sentinel for "no ETA yet" (stalled/just-started
 *  torrents report this instead of a real estimate). Mapped to null in
 *  KioskDownloadItem rather than passed through — 8640000 seconds (100
 *  days) rendered as a countdown would be actively misleading on a wall
 *  tablet. */
const QBIT_ETA_INFINITY = 8640000;

/**
 * Kiosk download-tray data for the public, unauthenticated /kiosk surface.
 * Reuses the SAME qbitSessions cache and qbitLogin/try-unauthenticated-
 * first-then-retry-once shape as the `qbittorrent` fetcher above — one
 * source of truth for qBittorrent auth in this file — but returns a
 * different, narrower shape (KioskDownloadItem, not WidgetField[]) built
 * specifically for that public route: no server URL, no credentials,
 * nothing beyond what a wall tablet needs to draw a progress bar.
 */
export async function getKioskDownloads(): Promise<KioskDownloadsResult> {
  const w = loadConfig().widgets.find((x) => x.type === "qbittorrent");
  if (!w) return { status: "unconfigured" };

  const run = async (cookie?: string) => {
    const h: Record<string, string> = { Referer: w.url, Origin: w.url };
    if (cookie) h.Cookie = cookie;
    return fetchJson<QbitDownloadingTorrent[]>(`${w.url}/api/v2/torrents/info?filter=downloading`, { headers: h });
  };

  let torrents: QbitDownloadingTorrent[];
  try {
    try {
      torrents = await run(qbitSessions.get(w.url)?.cookie);
    } catch (e) {
      if (!(e instanceof WidgetError) || !e.message.startsWith("HTTP 40")) throw e;
      qbitSessions.delete(w.url); // unauthenticated/stale — log in and retry once
      torrents = await run(await qbitLogin(w));
    }
  } catch {
    return { status: "unreachable" };
  }

  // The ignore-zero-speed rule is enforced HERE, server-side, before anything
  // reaches the unauthenticated tablet — a torrent qBittorrent still lists as
  // "downloading" but with no current throughput (queued, stalled, paused
  // mid-check) is not what the owner asked to be notified about.
  const items: KioskDownloadItem[] = torrents
    .filter((t) => t.dlspeed > 0)
    .map((t) => ({
      hash: t.hash,
      name: t.name,
      progress: t.progress,
      dlspeed: t.dlspeed,
      size: t.size,
      eta: t.eta === QBIT_ETA_INFINITY ? null : t.eta,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { status: "ok", items };
}

// --- Pi-hole v6 (sid session) -----------------------------------------------

const piholeSessions = new Map<string, { sid: string; ts: number }>();

async function piholeAuth(w: WidgetInstance): Promise<string> {
  const cached = piholeSessions.get(w.url);
  if (cached && Date.now() - cached.ts < 4 * 60 * 1000) return cached.sid;
  const res = await fetchJson<{ session: { valid: boolean; sid: string } }>(`${w.url}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: w.password || w.key || "" }),
  });
  if (!res.session?.valid) throw new WidgetError("auth failed");
  piholeSessions.set(w.url, { sid: res.session.sid, ts: Date.now() });
  return res.session.sid;
}

const pihole: WidgetFetcher = async (w) => {
  const run = async (sid: string) => {
    const s = await fetchJson<{
      queries: { total: number; blocked: number; percent_blocked: number; forwarded: number };
    }>(`${w.url}/api/stats/summary`, { headers: { "X-FTL-SID": sid } });
    return [
      { label: "Queries", value: formatNumber(s.queries.total) },
      { label: "Blocked", value: formatNumber(s.queries.blocked) },
      { label: "Blocked %", value: formatPercent(s.queries.percent_blocked, 1) },
      { label: "Forwarded", value: formatNumber(s.queries.forwarded) },
    ];
  };
  try {
    return await run(await piholeAuth(w));
  } catch (e) {
    if (e instanceof WidgetError && e.message.startsWith("HTTP 40")) {
      piholeSessions.delete(w.url);
      return run(await piholeAuth(w));
    }
    throw e;
  }
};

/** Toggle blocking (G3 widget actions) — POST /api/dns/blocking, the v6 REST
 *  endpoint matching the sid-session generation the read-only fetcher above
 *  already speaks. `timerSec` omitted means "disable indefinitely"; the
 *  route only ever calls this with 300 (5 min) or with `blocking: true`. */
export async function piholeSetBlocking(w: WidgetInstance, blocking: boolean, timerSec?: number): Promise<void> {
  const body = JSON.stringify(blocking ? { blocking: true } : { blocking: false, timer: timerSec ?? null });
  const attempt = async (sid: string) =>
    postAction(`${w.url}/api/dns/blocking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-FTL-SID": sid },
      body,
    });
  try {
    await attempt(await piholeAuth(w));
  } catch (e) {
    if (e instanceof WidgetError && e.message.startsWith("HTTP 40")) {
      piholeSessions.delete(w.url);
      await attempt(await piholeAuth(w));
      return;
    }
    throw e;
  }
}

// --- Seerr / Jellyseerr -----------------------------------------------------

const seerr: WidgetFetcher = async (w) => {
  const c = await fetchJson<{ pending: number; approved: number; available: number }>(
    `${w.url}/api/v1/request/count`,
    { headers: { "X-Api-Key": w.key || "" } },
  );
  return [
    { label: "Pending", value: formatNumber(c.pending), intent: c.pending > 0 ? "warn" : undefined },
    { label: "Approved", value: formatNumber(c.approved) },
    { label: "Available", value: formatNumber(c.available) },
  ];
};

// --- Glances v4 -------------------------------------------------------------

const glances: WidgetFetcher = async (w) => {
  const [cpu, mem] = await Promise.all([
    fetchJson<{ total: number }>(`${w.url}/api/4/cpu`),
    fetchJson<{ percent: number }>(`${w.url}/api/4/mem`),
  ]);
  return [
    { label: "CPU", value: formatPercent(cpu.total, 1), intent: cpu.total > 85 ? "warn" : undefined },
    { label: "Memory", value: formatPercent(mem.percent, 1), intent: mem.percent > 90 ? "warn" : undefined },
  ];
};

// --- Generic JSON path ------------------------------------------------------

function formatGeneric(value: unknown, format?: string): string {
  if (value == null) return "—";
  const n = Number(value);
  switch (format) {
    case "bytes":
      return formatBytes(n);
    case "rate":
      return `${formatBytes(n)}/s`;
    case "percent":
      return formatPercent(n, 1);
    case "number":
      return formatNumber(n);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

const generic: WidgetFetcher = async (w) => {
  const url = w.endpoint
    ? w.endpoint.startsWith("http")
      ? w.endpoint
      : `${w.url}${w.endpoint}`
    : w.url;
  const headers: Record<string, string> = { ...(w.headers || {}) };
  if (w.key) headers["X-Api-Key"] = w.key;
  const data = await fetchJson<unknown>(url, { headers });
  const fields = w.fields || [];
  if (!fields.length) return [{ label: "Response", value: "OK", intent: "ok" }];
  return fields.map((f): WidgetField => {
    return { label: f.label, value: formatGeneric(resolvePath(data, f.path), f.format) };
  });
};

export const BUILTIN_WIDGETS: Record<string, WidgetFetcher> = {
  sonarr,
  radarr,
  prowlarr,
  bazarr,
  qbittorrent,
  pihole,
  seerr,
  jellyseerr: seerr,
  glances,
  generic,
};

export const WIDGET_TYPE_NAMES = Object.keys(BUILTIN_WIDGETS);
