import { loadConfig } from "@/lib/config";
import type {
  GitBranchSummary,
  GitCommitEntry,
  GitMirror,
  GitMirrorDefaultBranch,
  GitPullRequest,
  GitRepoSummary,
  GitSnapshot,
} from "@/lib/forgejo-types";

/**
 * Server-only Forgejo client for the /git commit stream + mirror-sync
 * visualizer. Talks to Forgejo's stable v1 API (Gitea-compatible:
 * /api/v1/...) with token auth, and optionally enriches push-mirror rows
 * with GitHub Compare data when `config.github.token` is set.
 *
 * Forgejo itself was freshly installed with no account yet at design time —
 * "not configured" therefore has to be a first-class, calm state rather than
 * an error, same treatment as jellyfin.ts gives a missing API key.
 */

const FORGEJO_TIMEOUT_MS = 5000;
const GITHUB_TIMEOUT_MS = 5000;
const REPO_CONCURRENCY = 6;
const STREAM_CAP = 50;
const BRANCH_CAP = 60;
const SNAPSHOT_TTL_MS = 30_000;

// --- credentials ------------------------------------------------------------

interface ForgejoCredentials {
  url: string;
  token: string;
}

function forgejoCredentials(): ForgejoCredentials | null {
  const cfg = loadConfig();
  const url = cfg.forgejo?.url?.trim();
  const token = cfg.forgejo?.token?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

function githubToken(): string | undefined {
  return loadConfig().github?.token?.trim() || undefined;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

// --- generic Forgejo fetch ---------------------------------------------------

interface ForgejoFetchOk<T> {
  ok: true;
  data: T;
}
interface ForgejoFetchErr {
  ok: false;
  kind: "unreachable" | "unauthorized" | "error";
  detail: string;
}
type ForgejoFetchResult<T> = ForgejoFetchOk<T> | ForgejoFetchErr;

async function forgejoFetch<T>(baseUrl: string, token: string, path: string): Promise<ForgejoFetchResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `token ${token}` },
      signal: AbortSignal.timeout(FORGEJO_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, kind: "unreachable", detail: `Forgejo did not respond within ${FORGEJO_TIMEOUT_MS / 1000}s.` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: "unauthorized", detail: `Forgejo rejected the API token (HTTP ${res.status}).` };
  }
  if (!res.ok) {
    return { ok: false, kind: "error", detail: `Forgejo returned HTTP ${res.status} for ${path}.` };
  }
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, kind: "error", detail: `Forgejo returned a non-JSON response for ${path}.` };
  }
}

/** Runs `fn` over `items` with at most `limit` in flight at once. Mirrors
 *  processes.ts's mapWithConcurrency (not exported from there, so a small
 *  local copy beats reaching into a module that isn't this feature's). A
 *  homelab Forgejo could plausibly hold dozens of repos, each needing four
 *  calls (commits/branches/pulls/push_mirrors) — uncapped, that's a burst of
 *  sockets against a single-core VM the moment /git loads. */
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

// --- Forgejo raw response shapes (minimal, only what we read) ---------------

interface ForgejoUser {
  login?: string;
}
interface ForgejoRepository {
  id: number;
  name: string;
  full_name: string;
  owner?: ForgejoUser;
  private?: boolean;
  html_url: string;
  default_branch?: string;
  updated_at?: string;
}
interface ForgejoSearchReposResponse {
  ok?: boolean;
  data?: ForgejoRepository[];
}
interface ForgejoCommitPerson {
  name?: string;
  date?: string;
}
interface ForgejoCommitInfo {
  message?: string;
  author?: ForgejoCommitPerson;
}
interface ForgejoCommitRaw {
  sha: string;
  html_url: string;
  commit?: ForgejoCommitInfo;
}
interface ForgejoBranchCommit {
  id?: string;
  timestamp?: string;
}
interface ForgejoBranchRaw {
  name: string;
  commit?: ForgejoBranchCommit;
}
interface ForgejoPullRequestRaw {
  number: number;
  title: string;
  user?: ForgejoUser;
  created_at?: string;
  html_url: string;
}
interface ForgejoPushMirrorRaw {
  remote_address?: string;
  last_update?: string | null;
  last_error?: string;
  interval?: string;
}

/** First line only, trimmed — see GitCommitEntry.message doc comment. */
function firstLine(message: string): string {
  const line = message.split("\n")[0]?.trim();
  return line || "(no message)";
}

/** Strips embedded userinfo (user:pass@ or token@) from a mirror's remote
 *  address before it ever leaves the server. Forgejo has been observed to
 *  echo push-mirror credentials back in `remote_address`, and "never expose
 *  tokens in responses" applies to every secret reaching the client, not
 *  only the ones this dashboard itself holds. */
function maskCredentials(url: string): string {
  return url.replace(/:\/\/[^/@]+@/, "://");
}

const GITHUB_REPO_RE = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i;

function parseGithubRepo(remoteAddress: string): { owner: string; repo: string } | null {
  const match = GITHUB_REPO_RE.exec(remoteAddress);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// --- GitHub enrichment (optional) --------------------------------------------

interface GithubBranchRaw {
  name: string;
  commit: { sha: string };
}
interface GithubCompareRaw {
  ahead_by: number;
  behind_by: number;
}

async function githubFetch(token: string, path: string): Promise<Response | null> {
  try {
    return await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        // GitHub's REST API 4xx's requests with no User-Agent.
        "User-Agent": "nightwatch-dashboard",
      },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/**
 * head-sha equality decides synced vs diverged; a full ahead/behind count is
 * only attempted for the default branch, via GitHub's own Compare API,
 * because that call can only diff two commits GitHub already holds as
 * objects. Forgejo's head sha IS a real object in the GitHub repo once a
 * prior mirror sync has pushed it — but if Forgejo has commits made *since*
 * the last sync, GitHub has never seen those sha's at all, and the compare
 * call 404s. That case still reports "diverged", just without counts —
 * degrading the number, not the verdict.
 */
async function compareGithubDefaultBranch(
  token: string,
  ghRepo: { owner: string; repo: string },
  branchName: string,
  forgejoHeadSha: string,
): Promise<GitMirrorDefaultBranch> {
  const branchesRes = await githubFetch(token, `/repos/${enc(ghRepo.owner)}/${enc(ghRepo.repo)}/branches?per_page=100`);
  if (!branchesRes || !branchesRes.ok) return { state: "unknown" };

  let branches: GithubBranchRaw[];
  try {
    branches = (await branchesRes.json()) as GithubBranchRaw[];
  } catch {
    return { state: "unknown" };
  }

  const branch = branches.find((b) => b.name === branchName);
  if (!branch) return { state: "unknown" };
  if (branch.commit.sha === forgejoHeadSha) return { state: "synced" };

  const compareRes = await githubFetch(
    token,
    `/repos/${enc(ghRepo.owner)}/${enc(ghRepo.repo)}/compare/${enc(branch.commit.sha)}...${enc(forgejoHeadSha)}`,
  );
  if (!compareRes || !compareRes.ok) return { state: "diverged" };
  try {
    const compare = (await compareRes.json()) as GithubCompareRaw;
    return { state: "diverged", aheadBy: compare.ahead_by, behindBy: compare.behind_by };
  } catch {
    return { state: "diverged" };
  }
}

// --- per-repo fetch -----------------------------------------------------------

interface RepoBundle {
  commits: GitCommitEntry[];
  branches: GitBranchSummary[];
  pulls: GitPullRequest[];
  mirror: GitMirror | null;
}

/**
 * Four calls per repo, best-effort: a repo whose push_mirrors endpoint 403's
 * (a read-only token, no mirror configured) or whose pulls list is empty
 * simply contributes nothing for that field — it never demotes the whole
 * snapshot's status. Only the top-level /repos/search call (in
 * buildGitSnapshot) decides unreachable/unauthorized/ok for the page.
 */
async function fetchRepoBundle(
  baseUrl: string,
  token: string,
  repo: GitRepoSummary,
  ghToken: string | undefined,
): Promise<RepoBundle> {
  const base = `/api/v1/repos/${enc(repo.owner)}/${enc(repo.name)}`;
  const [commitsRes, branchesRes, pullsRes, mirrorsRes] = await Promise.all([
    forgejoFetch<ForgejoCommitRaw[]>(baseUrl, token, `${base}/commits?limit=20`),
    forgejoFetch<ForgejoBranchRaw[]>(baseUrl, token, `${base}/branches`),
    forgejoFetch<ForgejoPullRequestRaw[]>(baseUrl, token, `${base}/pulls?state=open`),
    forgejoFetch<ForgejoPushMirrorRaw[]>(baseUrl, token, `${base}/push_mirrors`),
  ]);

  const commits: GitCommitEntry[] = commitsRes.ok
    ? commitsRes.data.map((c) => ({
        repo: repo.fullName,
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: firstLine(c.commit?.message ?? "(no message)"),
        authorName: c.commit?.author?.name ?? "unknown",
        date: c.commit?.author?.date ?? new Date(0).toISOString(),
        htmlUrl: c.html_url,
      }))
    : [];

  const branchRaws = branchesRes.ok ? branchesRes.data : [];
  const branches: GitBranchSummary[] = branchRaws.map((b) => ({
    repo: repo.fullName,
    name: b.name,
    commitDate: b.commit?.timestamp ?? null,
    isDefault: b.name === repo.defaultBranch,
  }));

  const pulls: GitPullRequest[] = pullsRes.ok
    ? pullsRes.data.map((p) => ({
        repo: repo.fullName,
        number: p.number,
        title: p.title,
        author: p.user?.login ?? null,
        createdAt: p.created_at ?? new Date(0).toISOString(),
        htmlUrl: p.html_url,
      }))
    : [];

  let mirror: GitMirror | null = null;
  if (mirrorsRes.ok && mirrorsRes.data.length > 0) {
    // A repo's push_mirrors list is effectively 0-or-1 for this dashboard's
    // use case (one local repo mirroring to one GitHub remote) — the first
    // entry is the one worth surfacing rather than fanning the UI out to N.
    const pm = mirrorsRes.data[0];
    const target = maskCredentials(pm.remote_address ?? "");
    const forgejoHead = branchRaws.find((b) => b.name === repo.defaultBranch)?.commit?.id ?? null;

    let defaultBranch: GitMirrorDefaultBranch = { state: "unknown" };
    const ghRepo = ghToken ? parseGithubRepo(target) : null;
    if (ghToken && ghRepo && forgejoHead) {
      defaultBranch = await compareGithubDefaultBranch(ghToken, ghRepo, repo.defaultBranch, forgejoHead);
    }

    mirror = {
      repo: repo.fullName,
      target,
      lastSync: pm.last_update ?? null,
      lastError: pm.last_error?.trim() ? pm.last_error : null,
      interval: pm.interval || null,
      defaultBranch,
    };
  }

  return { commits, branches, pulls, mirror };
}

// --- snapshot assembly + cache ------------------------------------------------

const globalForGit = globalThis as unknown as {
  // Mirrors docker.ts/gpu.ts's globalForX pattern so the cache survives Next
  // dev HMR reloads of this module instead of resetting on every edit.
  __gitSnapshotCache?: { at: number; url: string; data: GitSnapshot };
};

function unconfiguredSnapshot(): GitSnapshot {
  return {
    status: "unconfigured",
    forgejoUrl: null,
    // Prose only — the config.json snippet itself lives in git-status-panel.tsx
    // as a <pre> block (matching ha-status/proxy-status), not inline in a sentence.
    detail:
      "No Forgejo connection configured. Create the admin account at http://192.168.1.70:3010, " +
      "then mint an access token in Settings → Applications (read scopes cover everything this page " +
      "shows) and add this block to data/config.json on the server:",
    repos: [],
    stream: [],
    pulls: [],
    branches: [],
    mirrors: [],
  };
}

async function buildGitSnapshot(creds: ForgejoCredentials): Promise<GitSnapshot> {
  const searchRes = await forgejoFetch<ForgejoSearchReposResponse>(creds.url, creds.token, "/api/v1/repos/search?limit=50");
  if (!searchRes.ok) {
    return {
      // Folds forgejoFetch's generic "error" kind (a non-2xx status that
      // isn't 401/403, or an unparsable body) into "unreachable" — the /git
      // contract only has room for the four statuses in GitStatus, and
      // "Forgejo answered but something is wrong" reads closer to
      // unreachable than to either of the setup states.
      status: searchRes.kind === "unauthorized" ? "unauthorized" : "unreachable",
      forgejoUrl: creds.url,
      detail: searchRes.detail,
      repos: [],
      stream: [],
      pulls: [],
      branches: [],
      mirrors: [],
    };
  }

  const repos: GitRepoSummary[] = [];
  for (const r of searchRes.data.data ?? []) {
    const owner = r.owner?.login;
    if (!owner) continue;
    repos.push({
      id: r.id,
      owner,
      name: r.name,
      fullName: r.full_name,
      private: Boolean(r.private),
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch || "main",
      updatedAt: r.updated_at ?? new Date(0).toISOString(),
    });
  }

  const ghToken = githubToken();
  const bundles = await mapWithConcurrency(repos, REPO_CONCURRENCY, (repo) =>
    fetchRepoBundle(creds.url, creds.token, repo, ghToken),
  );

  const stream = bundles
    .flatMap((b) => b.commits)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, STREAM_CAP);

  const branches = bundles
    .flatMap((b) => b.branches)
    // Nulls (no reported commit timestamp) sort last rather than throwing —
    // "" compares less than any real ISO string under localeCompare.
    .sort((a, b) => (b.commitDate ?? "").localeCompare(a.commitDate ?? ""))
    .slice(0, BRANCH_CAP);

  // Oldest first: a PR open for three weeks is the one worth noticing, not
  // the one opened five minutes ago.
  const pulls = bundles.flatMap((b) => b.pulls).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const mirrors = bundles.map((b) => b.mirror).filter((m): m is GitMirror => m !== null);

  return { status: "ok", forgejoUrl: creds.url, repos, stream, pulls, branches, mirrors };
}

/** GET /api/git's data source. Cached ~30s server-side (per the spec's
 *  "server-side cache ~30s") so the ~60s client poll and any manual refresh
 *  don't both re-fan-out N*4 Forgejo calls plus GitHub enrichment back to
 *  back. */
export async function getGitSnapshot(): Promise<GitSnapshot> {
  const creds = forgejoCredentials();
  if (!creds) return unconfiguredSnapshot();

  const cached = globalForGit.__gitSnapshotCache;
  if (cached && cached.url === creds.url && Date.now() - cached.at < SNAPSHOT_TTL_MS) {
    return cached.data;
  }

  const data = await buildGitSnapshot(creds);
  globalForGit.__gitSnapshotCache = { at: Date.now(), url: creds.url, data };
  return data;
}

/** POST /api/git/sync's action: triggers Forgejo's own push-mirror job,
 *  which runs asynchronously on Forgejo's side — this only confirms Forgejo
 *  accepted the request, not that the sync has finished. Busts the snapshot
 *  cache so the next poll isn't stuck serving up to 30s of pre-sync state. */
export async function triggerPushMirrorSync(
  owner: string,
  repo: string,
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const creds = forgejoCredentials();
  if (!creds) return { ok: false, status: 400, detail: "Forgejo is not configured." };

  let res: Response;
  try {
    res = await fetch(`${creds.url}/api/v1/repos/${enc(owner)}/${enc(repo)}/push_mirrors-sync`, {
      method: "POST",
      headers: { Authorization: `token ${creds.token}` },
      signal: AbortSignal.timeout(FORGEJO_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 502, detail: "Forgejo did not respond to the sync request." };
  }

  if (res.ok) {
    globalForGit.__gitSnapshotCache = undefined;
    return { ok: true };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, detail: "Forgejo rejected the API token." };
  }
  if (res.status === 404) {
    return { ok: false, status: 404, detail: "That repo or mirror no longer exists." };
  }
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, detail: text || `Forgejo returned HTTP ${res.status}.` };
}
