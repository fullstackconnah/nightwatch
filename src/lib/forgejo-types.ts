/**
 * Normalized /git shapes shared between the server (src/lib/forgejo.ts) and
 * the client (src/lib/use-forgejo.ts, src/components/git-*.tsx). Import-free
 * leaf, same reasoning as transcode-types.ts: this file must not pull in
 * anything server-only (fs, config) so it stays safe to import from a
 * "use client" component.
 */

/** Same four-state shape as the rest of the dashboard's "not configured yet"
 *  integrations (jellyfin, HA, NPM): only ONE of these is a real failure to
 *  fetch data (`unreachable`) — the other two describe setup, not an outage. */
export type GitStatus = "unconfigured" | "unreachable" | "unauthorized" | "ok";

export interface GitRepoSummary {
  id: number;
  /** Repo owner's login, e.g. "homelab" — Forgejo is effectively single-user
   *  here, but the field is kept explicit rather than assumed. */
  owner: string;
  name: string;
  /** "owner/name" — the identity used everywhere else in this shape (chips,
   *  stream rows, mirror rows) so a reader never has to reassemble it. */
  fullName: string;
  private: boolean;
  htmlUrl: string;
  defaultBranch: string;
  updatedAt: string;
}

export interface GitCommitEntry {
  /** "owner/name" — see GitRepoSummary.fullName. */
  repo: string;
  sha: string;
  shortSha: string;
  /** First line only, already trimmed server-side — this is a stream row,
   *  not a diff view, so a multi-line commit body would just wrap ugly. */
  message: string;
  authorName: string;
  date: string;
  /** Links straight to Forgejo's commit diff, e.g. .../commit/<sha>. */
  htmlUrl: string;
}

export interface GitBranchSummary {
  repo: string;
  name: string;
  /** ISO timestamp of the branch tip's commit, or null when Forgejo didn't
   *  report one (never actually observed, but the branches endpoint doesn't
   *  guarantee it). Ranking falls back to "unranked, sorts last" for null. */
  commitDate: string | null;
  isDefault: boolean;
}

export interface GitPullRequest {
  repo: string;
  number: number;
  title: string;
  author: string | null;
  createdAt: string;
  htmlUrl: string;
}

/** "unknown" covers both "no GitHub token configured" and "the GitHub
 *  mirror's branch couldn't be matched" — neither is a real divergence, so
 *  neither earns the warn colour the Threshold Rule reserves for a real one. */
export type MirrorSyncState = "synced" | "diverged" | "unknown";

export interface GitMirrorDefaultBranch {
  state: MirrorSyncState;
  /** Commits the local (Forgejo) default branch has that the GitHub mirror
   *  doesn't yet. Only ever set alongside `behindBy`, and only when the
   *  GitHub compare API could resolve both commits as real objects — see
   *  compareGithubDefaultBranch in forgejo.ts for why that isn't guaranteed. */
  aheadBy?: number;
  /** Commits the GitHub mirror has that the local default branch doesn't —
   *  only possible if something pushed to GitHub directly, since this is a
   *  one-way push mirror. */
  behindBy?: number;
}

export interface GitMirror {
  /** "owner/name" of the LOCAL (Forgejo) repo being mirrored. */
  repo: string;
  /** The mirror's remote address, credentials stripped server-side. */
  target: string;
  /** ISO timestamp of the last successful sync, or null if it has never run. */
  lastSync: string | null;
  /** Forgejo's own error string from the last failed sync attempt, or null. */
  lastError: string | null;
  /** Forgejo's configured sync interval, e.g. "8h0m0s", or null if unset. */
  interval: string | null;
  defaultBranch: GitMirrorDefaultBranch;
}

export interface GitSnapshotOk {
  status: "ok";
  forgejoUrl: string;
  repos: GitRepoSummary[];
  /** Recent-first, merged across all repos, capped — see forgejo.ts. */
  stream: GitCommitEntry[];
  /** Open pull requests across all repos, oldest first — the ones that have
   *  been sitting longest are the ones worth noticing. */
  pulls: GitPullRequest[];
  /** Active branches across all repos, most-recently-committed first. */
  branches: GitBranchSummary[];
  mirrors: GitMirror[];
}

export interface GitSnapshotUnavailable {
  status: Exclude<GitStatus, "ok">;
  /** null only for "unconfigured" — every other status implies the URL was
   *  known, just not usable. */
  forgejoUrl: string | null;
  /** Human-readable explanation, always present. For "unconfigured" this
   *  carries the full setup copy — account, token, config.json snippet. */
  detail: string;
  repos: [];
  stream: [];
  pulls: [];
  branches: [];
  mirrors: [];
}

/** Flat shape by design — GET /api/git returns this directly, matching the
 *  contract every other page.tsx here expects from its SWR hook. `status`
 *  discriminates for TypeScript narrowing; the empty-array fields on the
 *  unavailable branch mean client code never has to write `data.repos ?? []`. */
export type GitSnapshot = GitSnapshotOk | GitSnapshotUnavailable;
