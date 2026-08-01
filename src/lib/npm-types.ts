/**
 * Wire contract for the Nginx Proxy Manager route map (/proxy). Import-free leaf,
 * same reason network-types.ts is: this file is reachable from a "use client" hook
 * (src/lib/use-npm.ts), so anything imported here lands in the browser bundle — and
 * the producer side (src/lib/npm.ts) reaches node fetch with admin credentials.
 */

/**
 * `unconfigured` — no "npm" block in data/config.json.
 * `unreachable`  — NPM did not answer (down, wrong URL, timeout) at the login step
 *                  or while fetching hosts/certificates.
 * `unauthorized` — NPM rejected the admin login (bad email/password).
 * `ok`           — routes and certificates below are live data.
 */
export type ProxyManagerStatus = "unconfigured" | "unreachable" | "unauthorized" | "ok";

/**
 * `up`      — the forward target answered an HTTP request, any status code included.
 *             A 401/403/500 still means something is alive and listening.
 * `down`    — the probe could not connect at all (refused, timed out).
 * `unknown` — not probed: the route is disabled, or it is a redirection host (its
 *             "target" is an arbitrary external domain, not an upstream this box runs).
 */
export type RouteHealth = "up" | "down" | "unknown";

/** The certificate attached to a route, trimmed to what the row needs — see
 *  ProxyCertificate for the full record shown in the certificates panel. */
export interface RouteCertRef {
  provider: string;
  /** ISO 8601, or null when NPM reports no expiry (e.g. a self-signed/custom cert). */
  expiresOn: string | null;
  /** Whole days from now to expiry; negative means already expired. Null mirrors expiresOn. */
  daysLeft: number | null;
}

export interface ProxyRoute {
  id: number;
  /** "proxy" hosts forward live traffic to an upstream this box can health-check;
   *  "redirection" hosts point a domain at an arbitrary URL and are never probed. */
  kind: "proxy" | "redirection";
  domains: string[];
  /** scheme://host:port for a proxy host, scheme://domain for a redirection host. */
  target: string;
  enabled: boolean;
  health: RouteHealth;
  cert: RouteCertRef | null;
}

export interface ProxyCertificate {
  id: number;
  domains: string[];
  provider: string;
  expiresOn: string | null;
  daysLeft: number | null;
}

export interface ProxyManagerSnapshot {
  status: ProxyManagerStatus;
  /** Human-readable explanation for any non-"ok" status — setup copy for
   *  "unconfigured", the transport failure for "unreachable", NPM's own rejection
   *  for "unauthorized". Absent when status is "ok". */
  detail?: string;
  routes: ProxyRoute[];
  /** Expiry-sorted (soonest first, nulls last) by the producer, not the client. */
  certificates: ProxyCertificate[];
  /** NPM's own admin UI base URL, for the link-out button. Null only when
   *  unconfigured — every other status still had a URL to try. */
  npmUrl: string | null;
}
