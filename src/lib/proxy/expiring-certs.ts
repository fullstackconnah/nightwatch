// Relative imports with explicit .ts: node --test has no "@/" resolver.
import type { ProxyManagerSnapshot } from "../types/npm.ts";
import { Memo } from "../cache.ts";
import { certVariant } from "./page-model.ts";

/** Let's Encrypt certificates renew at about 30 days left, so under 14 means renewal is failing (the Proxy page warns at 30). */
export const WARN_DAYS = 14;

export interface ExpiringCerts {
  count: number;
  /** Lowest daysLeft among the counted certificates, null when none. */
  soonest: number | null;
}

/** Not-ok snapshots (not set up, unreachable, login refused) count 0: the Proxy page already says so. A null daysLeft is never counted. */
export function expiringCerts(s: Pick<ProxyManagerSnapshot, "status" | "certificates">): ExpiringCerts {
  if (s.status !== "ok") return { count: 0, soonest: null };
  const left = s.certificates.map((c) => c.daysLeft).filter((d): d is number => d !== null && d < WARN_DAYS);
  return { count: left.length, soonest: left.length ? Math.min(...left) : null };
}

/** Certificates change once a day, and the snapshot logs in and probes every route, so Home reads it at most hourly. */
export const CERTS_TTL_MS = 60 * 60_000;
/** A not-ok reading (NPM down or refusing) is cheap to retry, so it does not hold for the hour. */
export const CERTS_RETRY_MS = 5 * 60_000;

export const certSeverity = (soonest: number): "warn" | "bad" => (certVariant(soonest) === "bad" ? "bad" : "warn");

type Reading = ExpiringCerts & { ok: boolean; at: number };

/**
 * Cached reader: no snapshot call inside the TTL, one load in flight, and once a reading exists it is
 * returned at once while a stale one refreshes behind it (Memo has no stale-while-refresh, so peek() first).
 * Only the very first read waits for the snapshot; a fetch that throws counts 0.
 */
export function cachedExpiringCerts(
  fetchSnapshot: () => Promise<Pick<ProxyManagerSnapshot, "status" | "certificates">>,
  opts: { key: string; now?: () => number },
): () => Promise<ExpiringCerts> {
  const now = opts.now ?? Date.now;
  const memo = new Memo<Reading>({
    key: opts.key,
    ttlMs: CERTS_TTL_MS,
    now,
    isValid: (r) => r.ok || now() - r.at < CERTS_RETRY_MS,
    load: async () => {
      try {
        const snap = await fetchSnapshot();
        return { ...expiringCerts(snap), ok: snap.status === "ok", at: now() };
      } catch {
        return { count: 0, soonest: null, ok: false, at: now() };
      }
    },
  });
  return async () => {
    const last = memo.peek();
    const next = memo.get(); // never rejects: load catches
    const { count, soonest } = last ?? (await next);
    return { count, soonest };
  };
}
