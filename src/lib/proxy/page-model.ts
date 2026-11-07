/* /proxy's whole story in one pure function: the head (chip, answer, evidence, notice), the two strips, and which
 * strip the answer names. Read-only, so there are no writes. NPM's upstream `detail` (it can hold a host) is never
 * read. Type-only imports so node:test can load it. Section 7 of the strips pattern 4 shape brief is the spec;
 * page-model.test.ts has a case per state. */
import { connectionHead } from "../integration-head.ts";
import { ageText } from "../home.ts";
import type { ProxyCertificate, ProxyManagerSnapshot, ProxyRoute } from "../types/npm.ts";

export type StripId = "routes" | "certs";
export type Tone = "ok" | "neutral" | "warn" | "bad";

export interface ModelInput {
  data: ProxyManagerSnapshot | undefined;
  /** The poll is failing right now (SWR keeps the last good `data`). */
  loadError: boolean;
  /** ms of the last good answer, null before the first. */
  lastOkAt: number | null;
  now: number;
}
export interface Strip {
  id: StripId;
  title: string;
  state: string;
  tone: "warn" | "bad" | null;
}
export interface Model {
  chip: { tone: Tone; label: string };
  answer: string;
  evidence: string;
  notice: string | null;
  link: { href: string; label: string } | null;
  strips: Strip[];
  /** The strip the answer names, null (none), or "keep" (loading, stale, connection states: leave things as they are). */
  autoTarget: StripId | null | "keep";
  /** The opened strip's detail starts with this, so a clamped answer is never lost (R3). */
  detailLead: string | null;
  /** The page shows old data. */
  stale: boolean;
}

/** The snapshot polls every 30 s, so three polls. */
export const POLL_S = 30;
const STALE_MS = 3 * POLL_S * 1000;
const PAUSED = "Controls are paused while the page shows old data.";
const CONNECTION = { name: "Nginx Proxy Manager", place: "Settings → NPM", href: "/settings#npm", paused: "Routes and certificates", retryS: POLL_S };

/** Threshold Rule for certs: neutral >= 30d, warn < 30d, bad < 7d or already expired. */
export function certVariant(daysLeft: number | null): "neutral" | "warn" | "bad" {
  if (daysLeft === null) return "neutral";
  if (daysLeft < 7) return "bad";
  if (daysLeft < 30) return "warn";
  return "neutral";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const domainOf = (x: { domains: string[] }, fallback: string) => x.domains[0] || fallback;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`; // no-break space: "1 day" never wraps between number and unit
const head = (c: ReturnType<typeof connectionHead>): Model => ({
  chip: c.chip, answer: c.answer, evidence: c.evidence, notice: null, link: c.link, strips: [], autoTarget: c.autoTarget, detailLead: null, stale: false,
});

/** "expires in 3 days" / "expires today" / "expired 2 days ago". */
/** Whole days since expiry for a negative daysLeft; daysLeft is floored, so -1 is under 24 h ago (0). */
export const daysSinceExpiry = (daysLeft: number) => -daysLeft - 1;
const expiry = (d: number) => {
  if (d >= 0) return d === 0 ? "expires today" : `expires in ${days(d)}`;
  const n = daysSinceExpiry(d);
  return n === 0 ? "expired today" : `expired ${days(n)} ago`;
};

export function proxyModel(i: ModelInput): Model {
  const { data, now } = i;
  if (!data) return head(connectionHead(CONNECTION, i.loadError ? "error" : "loading"));
  if (data.status !== "ok") return head(connectionHead(CONNECTION, data.status));

  const age = i.lastOkAt === null ? 0 : Math.max(0, now - i.lastOkAt);
  const stale = i.loadError || age > STALE_MS;
  const link = data.npmUrl ? { href: data.npmUrl, label: "Open NPM admin" } : null;

  // ---- facts ----
  const routes: ProxyRoute[] = data.routes;
  const down = routes.filter((r) => r.health === "down");
  const up = routes.filter((r) => r.health === "up").length;
  const unknown = routes.filter((r) => r.health === "unknown").length;
  // C23: the soonest certificate with a known expiry; a null never counts as expiring.
  const next = data.certificates.reduce<ProxyCertificate | null>(
    (a, c) => (c.daysLeft === null || (a !== null && a.daysLeft! <= c.daysLeft) ? a : c), null);
  const nextName = next ? domainOf(next, "an unnamed certificate") : "";
  const tone = next ? certVariant(next.daysLeft) : "neutral";

  let chip: Model["chip"] = { tone: "ok", label: "All up" };
  let answer: string;
  let autoTarget: Model["autoTarget"] = null;
  if (routes.length === 0) {
    chip = { tone: "neutral", label: "No routes" };
    answer = "Nginx Proxy Manager has no proxy or redirection hosts yet.";
  } else if (down.length > 0) {
    const names = down.map((r) => domainOf(r, "an unnamed route"));
    const list = names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", ");
    chip = { tone: "bad", label: `${down.length} down` };
    answer = `${plural(down.length, "route is", "routes are")} down: ${list}.`;
    autoTarget = "routes";
  } else if (next && tone !== "neutral") {
    chip = tone === "bad" ? { tone: "bad", label: "Cert expiring" } : { tone: "warn", label: "Cert soon" };
    answer = `The certificate for ${nextName} ${expiry(next.daysLeft!)}.`;
    autoTarget = "certs";
  } else if (up === 0) {
    chip = { tone: "neutral", label: "No health" };
    answer = `None of the ${routes.length} routes has a health result yet.`;
  } else if (unknown > 0) {
    chip = { tone: "ok", label: "Up" };
    answer = `${plural(up, "route is", "routes are")} up; ${unknown} ${unknown === 1 ? "has" : "have"} no health result yet.`;
  } else {
    answer = `${routes.length === 1 ? "The route is" : `All ${routes.length} routes are`} up.` +
      (next ? ` The next certificate to expire is ${nextName}, in ${days(next.daysLeft!)}.` : "");
  }
  const detailLead = autoTarget ? answer : null;

  let evidence = `Updated ${ageText(age)} ago · checks every ${POLL_S} s`;
  let notice: string | null = null;
  if (stale) {
    chip = { tone: "neutral", label: "Stale" };
    answer = `Showing what was true ${ageText(age)} ago: ${answer}`;
    evidence = `Last update ${ageText(age)} ago · Nginx Proxy Manager stopped answering`;
    notice = PAUSED;
    autoTarget = "keep";
  }

  // ---- strips (none for an NPM with no routes) ----
  const routeParts = [down.length ? `${down.length} down` : null, up ? `${up} up` : null, unknown ? `${unknown} unknown` : null].filter(Boolean);
  const certState = data.certificates.length === 0 ? "None" : !next ? "No expiry dates"
    : tone === "neutral" ? `Next: ${nextName} in ${days(next.daysLeft!)}` : `${nextName} ${expiry(next.daysLeft!)}`;
  const strips: Strip[] = routes.length === 0 ? [] : [
    { id: "routes", title: "Routes", tone: down.length ? "bad" : null, state: routeParts.join(" · ") },
    { id: "certs", title: "Certificates", tone: tone === "neutral" ? null : tone, state: certState },
  ];

  return { chip, answer, evidence, notice, link, strips, autoTarget, detailLead, stale };
}
