/* /git's whole story in one pure function: the head (chip, answer, evidence, notice), the four strips, which strip the
 * answer names, and whether Sync now is on. Forgejo's upstream `detail` (it can hold a host) is never read, and an
 * address, a URL or the Forgejo host inside a mirror error is redacted. Type-only imports so node:test can load it.
 * Section 6 of the strips pattern 4 shape brief is the spec; page-model.test.ts has a case per state. */
import { connectionHead } from "../integration-head.ts";
import { ageText } from "../home.ts";
import type { GitMirror, GitSnapshot, GitSnapshotOk } from "../types/forgejo.ts";

export type StripId = "mirrors" | "pulls" | "branches" | "commits";
export type WriteId = "sync";
export type Tone = "ok" | "neutral" | "warn" | "bad";

export interface ModelInput {
  data: GitSnapshot | undefined;
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
  writes: { id: WriteId; enabled: boolean; reason: string | null }[];
  /** The page shows old data: Sync now is off. */
  stale: boolean;
}

/** The snapshot polls every 60 s, so three polls. */
export const POLL_S = 60;
const STALE_MS = 3 * POLL_S * 1000;
const PAUSED = "Controls are paused while the page shows old data.";
const CONNECTION = { name: "Forgejo", place: "Settings → Forgejo", href: "/settings#forgejo", paused: "Commits, pull requests and mirrors", retryS: POLL_S };

/** First line of an upstream error, short, with any address, URL and the Forgejo host redacted. */
export function safeLine(s: string | null, forgejoUrl?: string | null): string {
  let t = (s ?? "").split(/\r?\n/)[0].trim();
  try {
    if (forgejoUrl) {
      const u = new URL(forgejoUrl);
      for (const h of [u.host, u.hostname]) if (h) t = t.split(h).join("the server");
    }
  } catch { /* not a URL: nothing to redact */ }
  return t
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "a URL")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?/g, "an address")
    .replace(/\.$/, "")
    .slice(0, 160);
}

/** "+2 ahead, -1 behind" for a diverged mirror; null when the mirror has not diverged. */
export function divergence(m: GitMirror): string | null {
  if (m.defaultBranch.state !== "diverged") return null;
  const { aheadBy, behindBy } = m.defaultBranch;
  const parts: string[] = [];
  if (aheadBy) parts.push(`+${aheadBy} ahead`);
  if (behindBy) parts.push(`-${behindBy} behind`);
  return parts.join(", ");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const off = (reason: string | null): Model["writes"] => [{ id: "sync", enabled: false, reason }];
const head = (c: ReturnType<typeof connectionHead>): Model => ({
  chip: c.chip, answer: c.answer, evidence: c.evidence, notice: null, link: c.link, strips: [], autoTarget: c.autoTarget, detailLead: null, writes: off(null), stale: false,
});

export function gitModel(i: ModelInput): Model {
  const { data, now } = i;
  if (!data) return head(connectionHead(CONNECTION, i.loadError ? "error" : "loading"));
  if (data.status !== "ok") return head(connectionHead(CONNECTION, data.status));

  const g: GitSnapshotOk = data;
  const age = i.lastOkAt === null ? 0 : Math.max(0, now - i.lastOkAt);
  const stale = i.loadError || age > STALE_MS;
  const ago = (iso: string) => ageText(Math.max(0, now - Date.parse(iso)));
  const link = { href: g.forgejoUrl, label: "Open Forgejo" };

  // ---- facts ----
  const failing = g.mirrors.filter((m) => m.lastError);
  const diverged = g.mirrors.filter((m) => !m.lastError && m.defaultBranch.state === "diverged");
  const inSync = g.mirrors.length - failing.length - diverged.length;
  const newest = <T,>(xs: T[], at: (x: T) => string) => xs.reduce<T | null>((a, x) => (a === null || Date.parse(at(x)) > Date.parse(at(a)) ? x : a), null);
  const lastCommit = newest(g.stream.filter((c): c is typeof c & { date: string } => c.date !== null), (c) => c.date);
  const newestPull = newest(g.pulls, (p) => p.createdAt);
  const offDefault = g.branches.filter((b) => !b.isDefault).length;
  const prs = g.pulls.length === 0 ? "No open pull requests" : `${plural(g.pulls.length, "open pull request", "open pull requests")}`;
  const last = lastCommit ? `last commit ${ago(lastCommit.date)} ago in ${lastCommit.repo}` : "no commits yet";
  const tail = `${prs}; ${last}.`;

  let chip: Model["chip"] = { tone: "ok", label: "In sync" };
  let answer: string;
  if (g.repos.length === 0) {
    chip = { tone: "neutral", label: "Empty" };
    answer = "Forgejo has no repos yet.";
  } else if (failing.length > 0) {
    chip = { tone: "bad", label: "Mirror failing" };
    answer = failing.length === 1
      ? `The ${failing[0].repo} mirror to GitHub failed: ${safeLine(failing[0].lastError, g.forgejoUrl)}.`
      : `${failing.length} mirrors to GitHub are failing: ${failing.map((m) => m.repo).join(", ")}.`;
  } else if (diverged.length > 0) {
    chip = { tone: "warn", label: "Diverged" };
    const by = divergence(diverged[0]);
    answer = diverged.length === 1
      ? `${diverged[0].repo} has diverged from GitHub${by ? `: ${by}` : ""}.`
      : `${diverged.length} repos have diverged from GitHub: ${diverged.map((m) => m.repo).join(", ")}.`;
  } else if (g.mirrors.length === 0) {
    chip = { tone: "neutral", label: "No mirrors" };
    answer = `No mirrors to GitHub are set up. ${tail}`;
  } else {
    answer = `${g.mirrors.length === 1 ? "The mirror is" : `All ${g.mirrors.length} mirrors are`} in sync with GitHub. ${tail}`;
  }

  let evidence = `Updated ${ageText(age)} ago · checks every ${POLL_S} s`;
  let notice: string | null = null;
  let autoTarget: Model["autoTarget"] = failing.length > 0 || diverged.length > 0 ? "mirrors" : null;
  if (stale) {
    chip = { tone: "neutral", label: "Stale" };
    answer = `Showing what was true ${ageText(age)} ago: ${answer}`;
    evidence = `Last update ${ageText(age)} ago · Forgejo stopped answering`;
    notice = PAUSED;
    autoTarget = "keep";
  }

  // ---- strips (none for a Forgejo with no repos) ----
  const mirrorParts = [
    failing.length ? `${failing.length} failing` : null,
    diverged.length ? `${diverged.length} diverged` : null,
    inSync ? `${inSync} in sync` : null,
  ].filter(Boolean);
  const strips: Strip[] = g.repos.length === 0 ? [] : [
    {
      id: "mirrors", title: "Mirrors", tone: failing.length ? "bad" : diverged.length ? "warn" : null,
      state: g.mirrors.length === 0 ? "None set up" : mirrorParts.join(" · "),
    },
    {
      id: "pulls", title: "Pull requests", tone: null,
      state: newestPull ? `${g.pulls.length} open · newest ${ago(newestPull.createdAt)} ago` : "None open",
    },
    {
      id: "branches", title: "Branches", tone: null,
      state: g.branches.length === 0 ? "No branches reported yet" : offDefault === 0 ? "Everything is on its default branch" : `${offDefault} off the default branch`,
    },
    {
      id: "commits", title: "Commits", tone: null,
      state: lastCommit ? `${ago(lastCommit.date)} ago · ${lastCommit.repo}: ${lastCommit.message}` : "No commits yet",
    },
  ];

  return {
    chip, answer, evidence, notice, link, strips, autoTarget, detailLead: null, stale,
    writes: [{ id: "sync", enabled: !stale, reason: stale ? PAUSED : null }],
  };
}
