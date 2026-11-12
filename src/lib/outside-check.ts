/* The outside-access check: does the public internet reach this box's own site through
 * Cloudflare? Pure logic plus two small network deps. `node:` imports only (no "@/"), so
 * node:test loads it. attention.ts owns the memo and the probe row.
 *
 * It makes requests from a config value, so it is a request-forgery boundary:
 *  - the hostname is validated on save and on every run (hostnameError);
 *  - it is resolved through public DNS over HTTPS at an IP literal, never the system resolver;
 *  - every answer must be a public IPv4 before any connection (isPublicIPv4);
 *  - the connection is pinned to the checked address, follows no redirect and reads no body;
 *  - nothing derived from an error message leaves this module: only fixed copy and why codes. */
import { BlockList, isIP, isIPv4, type LookupFunction } from "node:net";
import https from "node:https";
import { outsideDown, outsideUnchecked, type AlertCopy } from "./attention-copy.ts";

export const OUTSIDE_STREAK = 3;
export const DOH_URL = "https://1.1.1.1/dns-query";
export const DOH_TIMEOUT_MS = 3_000;
export const CONNECT_TIMEOUT_MS = 8_000;
export const DOH_BODY_MAX = 8_192;

export type DownWhy = "no-dns" | "private-address" | "edge-cant-reach-box" | "timeout" | "bad-certificate" | "not-found";
export type UncheckedWhy = "no-internet" | "not-via-cloudflare" | "edge-only" | "redirects-away" | "bad-host" | "refused";
export type OutsideReading = { kind: "up" } | { kind: "down"; why: DownWhy } | { kind: "unchecked"; why: UncheckedWhy };
export interface OutsideState {
  shown: "clear" | "down" | "unchecked";
  downRun: number;
  uncheckedRun: number;
  downWhy?: DownWhy;
  uncheckedWhy?: UncheckedWhy;
}
export const OUTSIDE_START: OutsideState = { shown: "clear", downRun: 0, uncheckedRun: 0 };

export interface EdgeAnswer {
  status: number;
  location?: string;
  cfRay: boolean;
  cacheStatus?: string;
  mitigated: boolean;
}
export interface OutsideDeps {
  /** Throws when the internet can't be asked (read as could-not-check). */
  resolveA(host: string): Promise<{ kind: "found"; addrs: string[] } | { kind: "nxdomain" }>;
  /** Opens `host` pinned to `ip`. Throws are classified by err.code only (classifyConnectError). */
  connect(host: string, ip: string): Promise<EdgeAnswer>;
}

const DOWN_WHYS: DownWhy[] = ["no-dns", "private-address", "edge-cant-reach-box", "timeout", "bad-certificate", "not-found"];
const UNCHECKED_WHYS: UncheckedWhy[] = ["no-internet", "not-via-cloudflare", "edge-only", "redirects-away", "bad-host", "refused"];

// --- the hostname -----------------------------------------------------------------------------

export const HOSTNAME_ERROR = "Use a plain name like status.example.com, with no https://, port or path.";
const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".internal", ".home.arpa", ".localhost"];
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The saved form: trimmed and lower-case. */
export const cleanHost = (raw: string): string => raw.trim().toLowerCase();

/** null = ok. The message is fixed and never echoes the input. */
export function hostnameError(raw: string): string | null {
  const h = cleanHost(typeof raw === "string" ? raw : "");
  const labels = h.split(".");
  const ok =
    h.length > 0 &&
    h.length <= 253 &&
    isIP(h) === 0 &&
    h !== "localhost" &&
    !LOCAL_SUFFIXES.some((s) => h.endsWith(s)) &&
    labels.length >= 2 &&
    labels.every((l) => LABEL.test(l)) &&
    /^[a-z]+$/.test(labels[labels.length - 1]);
  return ok ? null : HOSTNAME_ERROR;
}

/** The Settings route's rule for this field: a blank clears it, an absent or non-string key keeps it. */
export function mergeOutsideHost(
  body: { outsideCheckHost?: unknown },
  existing: string | undefined,
): { outsideCheckHost: string | undefined } | { error: string } {
  if (!("outsideCheckHost" in body) || typeof body.outsideCheckHost !== "string") return { outsideCheckHost: existing };
  const host = cleanHost(body.outsideCheckHost);
  if (!host) return { outsideCheckHost: undefined };
  const bad = hostnameError(host);
  return bad ? { error: bad } : { outsideCheckHost: host };
}

/** The gate: a blank host makes no request and returns null. */
export const outsideRun = <T>(host: string | undefined, read: (host: string) => Promise<T>): Promise<T> | null =>
  host?.trim() ? read(host) : null;

// --- public addresses only ----------------------------------------------------------------------

const PRIVATE_V4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  PRIVATE_V4.addSubnet(net, bits, "ipv4");
}

export const isPublicIPv4 = (ip: string): boolean => isIPv4(ip) && !PRIVATE_V4.check(ip, "ipv4");

/** A lookup that always answers with `ip`, in both the `{all:true}` and plain forms (Node 20+ asks for all). */
export function pinnedLookup(ip: string): LookupFunction {
  return ((_host: string, opts: unknown, cb?: unknown) => {
    const done = (typeof opts === "function" ? opts : cb) as (...a: unknown[]) => void;
    const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all === true;
    if (all) done(null, [{ address: ip, family: 4 }]);
    else done(null, ip, 4);
  }) as LookupFunction;
}

// --- classifying one run -------------------------------------------------------------------------

export function classifyAnswer(host: string, a: EdgeAnswer): OutsideReading {
  if (!a.cfRay) return { kind: "unchecked", why: "not-via-cloudflare" };
  if (a.mitigated || /^(hit|stale)$/i.test(a.cacheStatus ?? "")) return { kind: "unchecked", why: "edge-only" };
  if (a.status >= 300 && a.status < 400) {
    let same = false;
    try {
      same = !!a.location && new URL(a.location, `https://${host}/`).hostname === host;
    } catch {
      /* an unparsable Location proves nothing */
    }
    return same ? { kind: "up" } : { kind: "unchecked", why: "redirects-away" };
  }
  if (a.status === 404 || a.status === 410) return { kind: "down", why: "not-found" };
  if (a.status >= 400 && a.status < 500) return { kind: "unchecked", why: "refused" };
  return a.status >= 500 ? { kind: "down", why: "edge-cant-reach-box" } : { kind: "up" };
}

const TLS = /^(ERR_TLS_|CERT_|.*_SELF_SIGNED_|UNABLE_TO_VERIFY_|UNABLE_TO_GET_ISSUER_|HOSTNAME_MISMATCH)/;
const DOWN_NET = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ABORT_ERR"]);

/** By err.code or name only: the message can hold the hostname and is never read. */
export function classifyConnectError(e: unknown): OutsideReading {
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  const name = String((e as { name?: unknown } | null)?.name ?? "");
  if (TLS.test(code)) return { kind: "down", why: "bad-certificate" };
  if (DOWN_NET.has(code) || name === "TimeoutError" || name === "AbortError") return { kind: "down", why: "timeout" };
  return { kind: "unchecked", why: "no-internet" };
}

export async function readOutside(rawHost: string, deps: OutsideDeps): Promise<OutsideReading> {
  if (hostnameError(rawHost)) return { kind: "unchecked", why: "bad-host" };
  const host = cleanHost(rawHost);
  let found: Awaited<ReturnType<OutsideDeps["resolveA"]>>;
  try {
    found = await deps.resolveA(host);
  } catch {
    return { kind: "unchecked", why: "no-internet" };
  }
  if (found.kind === "nxdomain" || found.addrs.length === 0) return { kind: "down", why: "no-dns" };
  if (!found.addrs.every(isPublicIPv4)) return { kind: "down", why: "private-address" };
  try {
    return classifyAnswer(host, await deps.connect(host, found.addrs[0]));
  } catch (e) {
    return classifyConnectError(e);
  }
}

/** The streak: 3 consecutive downs (or could-not-checks) show; an up clears both; a could-not-check never clears a shown down. */
export function nextOutside(prev: OutsideState, r: OutsideReading): OutsideState {
  if (r.kind === "up") return OUTSIDE_START;
  if (r.kind === "down") {
    const downRun = prev.downRun + 1;
    return {
      // only an up clears a shown row: a down after a shown could-not-check keeps it
      shown: downRun >= OUTSIDE_STREAK || prev.shown === "down" ? "down" : prev.shown === "unchecked" ? "unchecked" : "clear",
      downRun,
      uncheckedRun: 0,
      downWhy: r.why,
      uncheckedWhy: prev.uncheckedWhy,
    };
  }
  const uncheckedRun = prev.uncheckedRun + 1;
  const show = r.why === "bad-host" || uncheckedRun >= OUTSIDE_STREAK || prev.shown === "unchecked";
  return {
    shown: prev.shown === "down" ? "down" : show ? "unchecked" : "clear",
    downRun: 0,
    uncheckedRun,
    downWhy: prev.downWhy,
    uncheckedWhy: r.why,
  };
}

/** What the probe reports: null = nothing wrong; a down is an alert; a could-not-check throws a fixed Error (the failed row). */
export function outsideCopy(s: OutsideState): AlertCopy | null {
  if (s.shown === "down" && s.downWhy) return outsideDown(s.downWhy);
  if (s.shown === "unchecked" && s.uncheckedWhy) throw new Error(outsideUnchecked(s.uncheckedWhy));
  return null;
}

/** One reading per call, with the streak state kept between calls. A different host starts over. Logs the why code on a change only. */
export function createOutsideTracker(read: (host: string) => Promise<OutsideReading>) {
  let state = OUTSIDE_START;
  let current: string | undefined;
  return async (host: string): Promise<OutsideState> => {
    if (host !== current) {
      current = host;
      state = OUTSIDE_START;
    }
    const next = nextOutside(state, await read(host));
    const why = next.shown === "down" ? next.downWhy : next.shown === "unchecked" ? next.uncheckedWhy : undefined;
    if (next.shown !== state.shown || why !== (state.shown === "down" ? state.downWhy : state.uncheckedWhy)) {
      console.warn(`[outside] ${next.shown}${why ? `: ${why}` : ""}`);
    }
    state = next;
    return next;
  };
}

// --- the test hook ---------------------------------------------------------------------------------

/**
 * NW_OUTSIDE_FAKE: a comma list of `up`, `down:<why>`, `unchecked:<why>` or `hang`. Each call takes the
 * next reading and the last repeats; no network is touched. An unknown token reads as could-not-check,
 * never up. `hang` never resolves. Unset or blank = null (the real deps run).
 */
export function fakeReadings(spec: string | undefined): (() => Promise<OutsideReading>) | null {
  const tokens = (spec ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const parse = (t: string): OutsideReading | "hang" => {
    if (t === "up") return { kind: "up" };
    if (t === "hang") return "hang";
    const [kind, why] = t.split(":");
    if (kind === "down" && DOWN_WHYS.includes(why as DownWhy)) return { kind, why: why as DownWhy };
    if (kind === "unchecked" && UNCHECKED_WHYS.includes(why as UncheckedWhy)) return { kind, why: why as UncheckedWhy };
    return { kind: "unchecked", why: "no-internet" };
  };
  const readings = tokens.map(parse);
  let i = 0;
  return () => {
    const r = readings[Math.min(i++, readings.length - 1)];
    return r === "hang" ? new Promise<OutsideReading>(() => {}) : Promise.resolve(r);
  };
}

/** The hook when set, otherwise the real deps. */
export const pickReader = (spec: string | undefined, deps: OutsideDeps): ((host: string) => Promise<OutsideReading>) => {
  const fake = fakeReadings(spec);
  return fake ? () => fake() : (host) => readOutside(host, deps);
};

// --- the real network (not unit-tested: tests inject deps) -------------------------------------------

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      void reader.cancel();
      throw new Error("body too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const realDeps: OutsideDeps = {
  async resolveA(host) {
    const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: "application/dns-json" },
      redirect: "manual",
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
    });
    if (res.status !== 200) {
      void res.body?.cancel();
      throw new Error("resolver");
    }
    const j = JSON.parse(await readCapped(res, DOH_BODY_MAX)) as { Status?: number; Answer?: { type?: number; data?: string }[] };
    if (j.Status === 3) return { kind: "nxdomain" };
    if (j.Status !== 0) throw new Error("resolver");
    const addrs = (j.Answer ?? []).flatMap((a) => (a.type === 1 && typeof a.data === "string" && isIPv4(a.data) ? [a.data] : []));
    return addrs.length ? { kind: "found", addrs } : { kind: "nxdomain" };
  },
  connect(host, ip) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: host,
          servername: host,
          port: 443,
          path: "/",
          method: "GET",
          headers: { host, accept: "*/*", "user-agent": "nightwatch-outside-check" },
          lookup: pinnedLookup(ip),
          agent: false,
          signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
        },
        (res) => {
          const h = res.headers;
          const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
          resolve({
            status: res.statusCode ?? 0,
            location: one(h.location),
            cfRay: !!one(h["cf-ray"]),
            cacheStatus: one(h["cf-cache-status"]),
            mitigated: h["cf-mitigated"] !== undefined,
          });
          res.destroy(); // headers are the whole answer: no body is read
        },
      );
      req.on("error", reject);
      req.end();
    });
  },
};
