import { loadConfig } from "@/lib/config";
import type {
  ProxyCertificate,
  ProxyManagerSnapshot,
  ProxyRoute,
  RouteCertRef,
  RouteHealth,
} from "@/lib/npm-types";

/**
 * Server-only Nginx Proxy Manager admin API client for the /proxy route map.
 * Credentials come from the top-level `npm` config block (see src/lib/config.ts) —
 * NPM only exposes /api/nginx/* to an authenticated admin, so this mints a bearer
 * token per the admin login and caches it in module scope (mirrors config.ts's own
 * mtime-keyed cache), re-authenticating once on a 401 rather than on every request.
 */

const API_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 3000;
const HEALTH_CACHE_MS = 15000;
const HEALTH_CONCURRENCY = 8;
// NPM issues long-lived tokens (default 1 day) but re-mints slightly early so a
// request never races an expiry that lands mid-flight.
const TOKEN_SAFETY_MARGIN_MS = 60_000;

interface NpmCredentials {
  url: string;
  email: string;
  password: string;
}

function npmCredentials(): NpmCredentials | null {
  const cfg = loadConfig();
  const url = cfg.npm?.url?.trim();
  const email = cfg.npm?.email?.trim();
  const password = cfg.npm?.password;
  if (!url || !email || !password) return null;
  return { url: url.replace(/\/+$/, ""), email, password };
}

// --- token cache -------------------------------------------------------------

interface TokenCacheEntry {
  url: string;
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCacheEntry | null = null;

type AuthResult = { ok: true; token: string } | { ok: false; reason: "unreachable" | "unauthorized"; detail: string };

interface NpmTokenResponse {
  token?: string;
  expires?: string;
}

async function requestToken(creds: NpmCredentials): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(`${creds.url}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: creds.email, secret: creds.password }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unreachable", detail: `NPM did not respond within ${API_TIMEOUT_MS / 1000}s.` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "unauthorized", detail: `NPM rejected the admin login (HTTP ${res.status}).` };
  }
  if (!res.ok) {
    return { ok: false, reason: "unreachable", detail: `NPM returned HTTP ${res.status} while logging in.` };
  }

  let body: NpmTokenResponse;
  try {
    body = (await res.json()) as NpmTokenResponse;
  } catch {
    return { ok: false, reason: "unreachable", detail: "NPM returned a non-JSON login response." };
  }
  if (!body.token) {
    return { ok: false, reason: "unreachable", detail: "NPM's login response carried no token." };
  }

  const expiresAt = body.expires ? Date.parse(body.expires) : NaN;
  tokenCache = {
    url: creds.url,
    token: body.token,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt - TOKEN_SAFETY_MARGIN_MS : Date.now() + 3_600_000,
  };
  return { ok: true, token: body.token };
}

/** Cached token when still fresh for this URL, otherwise mints a new one. */
async function ensureToken(creds: NpmCredentials): Promise<AuthResult> {
  if (tokenCache && tokenCache.url === creds.url && tokenCache.expiresAt > Date.now()) {
    return { ok: true, token: tokenCache.token };
  }
  return requestToken(creds);
}

// --- generic authenticated GET, with the 401-means-reauth-once contract ------

type ApiResult<T> = { kind: "ok"; data: T } | { kind: "unauthorized" } | { kind: "error"; detail: string };

async function npmGet<T>(url: string, token: string): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { kind: "error", detail: `NPM did not respond within ${API_TIMEOUT_MS / 1000}s.` };
  }
  if (res.status === 401 || res.status === 403) return { kind: "unauthorized" };
  if (!res.ok) return { kind: "error", detail: `NPM returned HTTP ${res.status} for ${url}.` };
  try {
    return { kind: "ok", data: (await res.json()) as T };
  } catch {
    return { kind: "error", detail: "NPM returned a non-JSON response." };
  }
}

// --- NPM raw API shapes (minimal, only what we read) --------------------------

interface NpmProxyHostRaw {
  id: number;
  domain_names: string[];
  forward_scheme: string;
  forward_host: string;
  forward_port: number;
  enabled: number;
  certificate_id: number | string | null;
}

interface NpmRedirectionHostRaw {
  id: number;
  domain_names: string[];
  forward_scheme: string;
  forward_domain_name: string;
  enabled: number;
  certificate_id: number | string | null;
}

interface NpmCertificateRaw {
  id: number;
  provider: string;
  domain_names: string[];
  expires_on: string | null;
}

// --- mapping helpers -----------------------------------------------------------

/** NPM emits "YYYY-MM-DD HH:mm:ss" (naive UTC) for expires_on — normalize to ISO. */
function parseNpmDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

function mapCertificate(raw: NpmCertificateRaw): ProxyCertificate {
  const expiresOn = parseNpmDate(raw.expires_on);
  return {
    id: raw.id,
    domains: raw.domain_names ?? [],
    provider: raw.provider || "unknown",
    expiresOn,
    daysLeft: daysUntil(expiresOn),
  };
}

function certRefFor(certId: number | string | null | undefined, certById: Map<number, ProxyCertificate>): RouteCertRef | null {
  const id = Number(certId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const cert = certById.get(id);
  if (!cert) return null;
  return { provider: cert.provider, expiresOn: cert.expiresOn, daysLeft: cert.daysLeft };
}

function mapProxyHost(raw: NpmProxyHostRaw, certById: Map<number, ProxyCertificate>): ProxyRoute {
  return {
    id: raw.id,
    kind: "proxy",
    domains: raw.domain_names ?? [],
    target: `${raw.forward_scheme}://${raw.forward_host}:${raw.forward_port}`,
    enabled: Boolean(raw.enabled),
    // Filled in by probeRoutes() below — every route starts "unknown" until probed.
    health: "unknown",
    cert: certRefFor(raw.certificate_id, certById),
  };
}

function mapRedirectionHost(raw: NpmRedirectionHostRaw, certById: Map<number, ProxyCertificate>): ProxyRoute {
  return {
    id: raw.id,
    kind: "redirection",
    domains: raw.domain_names ?? [],
    target: `${raw.forward_scheme}://${raw.forward_domain_name}`,
    enabled: Boolean(raw.enabled),
    // Never probed: a redirection target is an arbitrary external URL, not an
    // upstream this box runs — "up/down" would be answering the wrong question.
    health: "unknown",
    cert: certRefFor(raw.certificate_id, certById),
  };
}

// --- health probing: concurrent, capped, short-TTL cached ----------------------

interface HealthCacheEntry {
  status: RouteHealth;
  ts: number;
}

const healthCache = new Map<string, HealthCacheEntry>();

/** Any HTTP response — including 401/403/500 — means the upstream is alive.
 *  Only a transport-level failure (refused, timed out, DNS) means "down". HEAD
 *  first (cheap), falling back to GET for upstreams that refuse HEAD outright. */
async function probeTargetUncached(target: string): Promise<RouteHealth> {
  const attempt = (method: "HEAD" | "GET") =>
    fetch(target, { method, signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), cache: "no-store", redirect: "manual" });

  try {
    await attempt("HEAD");
    return "up";
  } catch {
    try {
      await attempt("GET");
      return "up";
    } catch {
      return "down";
    }
  }
}

async function probeTarget(target: string): Promise<RouteHealth> {
  const cached = healthCache.get(target);
  if (cached && Date.now() - cached.ts < HEALTH_CACHE_MS) return cached.status;
  const status = await probeTargetUncached(target);
  healthCache.set(target, { status, ts: Date.now() });
  return status;
}

/** Bounded-concurrency map: at most `limit` calls to `fn` in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Probes every enabled proxy-kind route's forward target, deduping shared
 *  targets so two routes that forward to the same upstream cost one probe. */
async function probeRoutes(routes: ProxyRoute[]): Promise<void> {
  const targets = [...new Set(routes.filter((r) => r.kind === "proxy" && r.enabled).map((r) => r.target))];
  if (targets.length === 0) return;
  const results = await mapWithConcurrency(targets, HEALTH_CONCURRENCY, probeTarget);
  const byTarget = new Map(targets.map((t, i) => [t, results[i]]));
  for (const route of routes) {
    if (route.kind === "proxy" && route.enabled) route.health = byTarget.get(route.target) ?? "unknown";
  }
}

// --- main -----------------------------------------------------------------

function unconfiguredSnapshot(): ProxyManagerSnapshot {
  return {
    status: "unconfigured",
    detail:
      'No Nginx Proxy Manager connection configured. Add an "npm" block to data/config.json: ' +
      '{ "npm": { "url": "http://192.168.1.70:81", "email": "<admin email>", "password": "<admin password>" } }',
    routes: [],
    certificates: [],
    npmUrl: null,
  };
}

export async function getProxyManagerSnapshot(): Promise<ProxyManagerSnapshot> {
  const creds = npmCredentials();
  if (!creds) return unconfiguredSnapshot();

  let auth = await ensureToken(creds);
  if (!auth.ok) {
    return { status: auth.reason, detail: auth.detail, routes: [], certificates: [], npmUrl: creds.url };
  }

  const fetchAll = (token: string) =>
    Promise.all([
      npmGet<NpmProxyHostRaw[]>(`${creds.url}/api/nginx/proxy-hosts`, token),
      npmGet<NpmRedirectionHostRaw[]>(`${creds.url}/api/nginx/redirection-hosts`, token),
      npmGet<NpmCertificateRaw[]>(`${creds.url}/api/nginx/certificates`, token),
    ]);

  let [hosts, redirs, certs] = await fetchAll(auth.token);

  // A 401 mid-fetch means the cached token expired between requests (or was
  // revoked) — re-auth exactly once, rather than per-endpoint, and retry.
  if (hosts.kind === "unauthorized" || redirs.kind === "unauthorized" || certs.kind === "unauthorized") {
    tokenCache = null;
    auth = await requestToken(creds);
    if (!auth.ok) {
      return { status: auth.reason, detail: auth.detail, routes: [], certificates: [], npmUrl: creds.url };
    }
    [hosts, redirs, certs] = await fetchAll(auth.token);
    if (hosts.kind === "unauthorized" || redirs.kind === "unauthorized" || certs.kind === "unauthorized") {
      return {
        status: "unauthorized",
        detail: "NPM rejected the admin credentials.",
        routes: [],
        certificates: [],
        npmUrl: creds.url,
      };
    }
  }

  const failed = [hosts, redirs, certs].find((r) => r.kind === "error");
  if (failed && failed.kind === "error") {
    return { status: "unreachable", detail: failed.detail, routes: [], certificates: [], npmUrl: creds.url };
  }

  const certRows = certs.kind === "ok" ? certs.data : [];
  const certificates = certRows.map(mapCertificate).sort((a, b) => {
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft;
  });
  const certById = new Map(certificates.map((c) => [c.id, c]));

  const hostRows = hosts.kind === "ok" ? hosts.data : [];
  const redirRows = redirs.kind === "ok" ? redirs.data : [];
  const routes = [
    ...hostRows.map((h) => mapProxyHost(h, certById)),
    ...redirRows.map((h) => mapRedirectionHost(h, certById)),
  ].sort((a, b) => (a.domains[0] ?? "").localeCompare(b.domains[0] ?? ""));

  await probeRoutes(routes);

  return { status: "ok", routes, certificates, npmUrl: creds.url };
}
