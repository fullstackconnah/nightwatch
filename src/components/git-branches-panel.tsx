import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import type { GitBranchSummary, GitPullRequest } from "@/lib/forgejo-types";

const BRANCH_DISPLAY_CAP = 10;

/**
 * One panel, two ranked lists — open PRs (oldest/longest-open first, see
 * forgejo.ts's buildGitSnapshot) then active branches (most-recently-committed
 * first). Kept as a single panel rather than two: both lists answer "what's
 * moving that isn't on the default branch yet", and DESIGN.md's One-Step
 * Rule already discourages a second nested panel for what is really one
 * section split by a hairline.
 */
export function GitBranchesPanel({ pulls, branches }: { pulls: GitPullRequest[]; branches: GitBranchSummary[] }) {
  const ranked = [...branches]
    .filter((b) => !b.isDefault)
    .sort((a, b) => (b.commitDate ?? "").localeCompare(a.commitDate ?? ""))
    .slice(0, BRANCH_DISPLAY_CAP);

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-line flex items-center justify-between gap-2">
        <span className="microlabel">open pull requests</span>
        <span className="font-mono text-xs text-ink-faint tabular-nums">{pulls.length || "—"}</span>
      </div>
      <div className="px-2 py-1.5">
        {pulls.length === 0 ? (
          <div className="px-2 py-2.5 text-xs text-ink-faint">no open pull requests</div>
        ) : (
          pulls.map((pr) => (
            <a
              key={`${pr.repo}#${pr.number}`}
              href={pr.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-2 py-2 min-h-11 md:min-h-0 rounded-md hover:bg-panel-2/60 transition-colors"
            >
              <Badge variant="accent" className="shrink-0">
                {pr.repo}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-sm text-ink" title={pr.title}>
                {pr.title}
              </span>
              <span className="shrink-0 font-mono text-xs text-ink-faint" title={pr.createdAt}>
                {relativeTime(pr.createdAt)}
              </span>
            </a>
          ))
        )}
      </div>

      <div className="px-4 pt-2 pb-2 border-t border-line flex items-center justify-between gap-2">
        <span className="microlabel">active branches</span>
        <span className="font-mono text-xs text-ink-faint tabular-nums">{branches.length || "—"}</span>
      </div>
      <div className="px-2 pb-2">
        {ranked.length === 0 ? (
          <div className="px-2 py-2.5 text-xs text-ink-faint">
            {branches.length === 0 ? "no branches reported yet" : "everything is on its default branch"}
          </div>
        ) : (
          ranked.map((b) => (
            <div key={`${b.repo}/${b.name}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <Badge className="shrink-0">{b.repo}</Badge>
              <span className="font-mono text-ink-dim truncate min-w-0 flex-1">{b.name}</span>
              <span className="shrink-0 font-mono text-ink-faint tabular-nums">
                {b.commitDate ? relativeTime(b.commitDate) : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
