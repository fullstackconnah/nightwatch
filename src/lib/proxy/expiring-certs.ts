// Relative imports with explicit .ts: node --test has no "@/" resolver.
import type { ProxyManagerSnapshot } from "../types/npm.ts";

/** NPM renews by itself at about 30 days left, so under 14 means renewal is failing (the Proxy page warns at 30). */
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

export async function expiringCertsFrom(fetchSnapshot: () => Promise<Pick<ProxyManagerSnapshot, "status" | "certificates">>): Promise<ExpiringCerts> {
  try {
    return expiringCerts(await fetchSnapshot());
  } catch {
    return { count: 0, soonest: null };
  }
}
