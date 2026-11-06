/* Fixtures for scripts/git-proxy-shots.mjs: the /api/git answer, one per capture state of the strips pattern 4 spec.
 * Placeholders only (the repo is public): hosts are example names, no address appears anywhere. The browser clock is
 * pinned to NOW, so every age is exact. "hang" never answers (loading); "fail" answers HTTP 500 (load error). */

export const NOW = Date.parse("2026-11-06T10:00:00Z");
const at = (ms) => new Date(NOW + ms).toISOString();
const H = 3_600_000;
const D = 24 * H;
const URL_ = "http://forgejo.example.test:3010";

const repo = (name, i) => ({ id: i, owner: "lab", name, fullName: `lab/${name}`, private: false, htmlUrl: `${URL_}/lab/${name}`, defaultBranch: "main", updatedAt: at(-H) });
const mirror = (name, over = {}) => ({
  repo: `lab/${name}`, target: `https://github.com/example/${name}`, lastSync: at(-H), lastError: null, interval: "8h0m0s", defaultBranch: { state: "synced" }, ...over,
});
const NAMES = ["alpha", "bravo", "charlie", "delta"];

export const ok = (over = {}) => ({
  status: "ok",
  forgejoUrl: URL_,
  repos: NAMES.map((n, i) => repo(n, i + 1)),
  stream: [
    { repo: "lab/alpha", sha: "a1b2c3d4e5", shortSha: "a1b2c3d", message: "Fix the digest schedule so it survives a restart", authorName: "Sam Example", date: at(-3 * H), htmlUrl: `${URL_}/c/1` },
    { repo: "lab/bravo", sha: "b2c3d4e5f6", shortSha: "b2c3d4e", message: "Add a retry to the mirror push", authorName: "Sam Example", date: at(-5 * H), htmlUrl: `${URL_}/c/2` },
    { repo: "lab/charlie", sha: "c3d4e5f6a7", shortSha: "c3d4e5f", message: "Bump the base image", authorName: "Sam Example", date: at(-1 * D), htmlUrl: `${URL_}/c/3` },
  ],
  pulls: [
    { repo: "lab/alpha", number: 4, title: "Move the schedule into config", author: "sam", createdAt: at(-1 * D), htmlUrl: `${URL_}/lab/alpha/pulls/4` },
    { repo: "lab/bravo", number: 9, title: "Retry mirror pushes with backoff", author: "sam", createdAt: at(-5 * D), htmlUrl: `${URL_}/lab/bravo/pulls/9` },
  ],
  branches: [
    { repo: "lab/alpha", name: "main", commitDate: at(-3 * H), isDefault: true },
    { repo: "lab/alpha", name: "feat/schedule-config", commitDate: at(-4 * H), isDefault: false },
    { repo: "lab/bravo", name: "fix/mirror-retry", commitDate: at(-6 * H), isDefault: false },
    { repo: "lab/charlie", name: "chore/base-image", commitDate: at(-1 * D), isDefault: false },
  ],
  mirrors: NAMES.map((n) => mirror(n)),
  ...over,
});

const none = { repos: [], stream: [], pulls: [], branches: [], mirrors: [] };
const down = (status, detail) => ({ status, forgejoUrl: URL_, detail, ...none });

export const FIXTURES = {
  loading: "hang",
  loadError: "fail",
  calm: ok(),
  mirrorError: ok({ mirrors: [mirror("alpha"), mirror("bravo", { lastError: `push to github.com failed: authentication rejected for ${URL_}` }), mirror("charlie"), mirror("delta")] }),
  diverged: ok({ mirrors: [mirror("alpha"), mirror("bravo"), mirror("charlie", { defaultBranch: { state: "diverged", aheadBy: 2, behindBy: 1 } }), mirror("delta")] }),
  noMirrors: ok({ mirrors: [] }),
  noRepos: ok({ repos: [], stream: [], pulls: [], branches: [], mirrors: [] }),
  unconfigured: { status: "unconfigured", forgejoUrl: null, detail: "No Forgejo connection configured.", ...none },
  unauthorized: down("unauthorized", "401 from the server"),
  unreachable: down("unreachable", "connect ECONNREFUSED"),
};
