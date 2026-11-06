/* THESIS: the Pull requests and Branches strips' details (the old one panel split in two, R18). Open PRs keep the
   server's oldest-first order and link out to Forgejo; branches are the active ones off the default, newest commit
   first, capped as before. OWN-WORLD: nightwatch console. */
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import type { GitBranchSummary, GitPullRequest } from "@/lib/types/forgejo";

export const BRANCH_DISPLAY_CAP = 10;

export function PullRows({ pulls }: { pulls: GitPullRequest[] }) {
  if (pulls.length === 0) return <p className="st-note">No open pull requests.</p>;
  return (
    <div>
      {pulls.map((pr) => (
        <a
          key={`${pr.repo}#${pr.number}`}
          href={pr.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-1 py-2 min-h-11 md:min-h-0 rounded-md hover:bg-panel-2/60 transition-colors"
        >
          <Badge variant="accent" className="shrink-0">{pr.repo}</Badge>
          <span className="min-w-0 flex-1 truncate text-sm text-ink" title={pr.title}>{pr.title}</span>
          <span className="shrink-0 font-mono text-xs text-ink-faint" title={pr.createdAt}>{relativeTime(pr.createdAt)}</span>
        </a>
      ))}
    </div>
  );
}

export function BranchRows({ branches }: { branches: GitBranchSummary[] }) {
  const ranked = [...branches]
    .filter((b) => !b.isDefault)
    .sort((a, b) => (b.commitDate ?? "").localeCompare(a.commitDate ?? ""))
    .slice(0, BRANCH_DISPLAY_CAP);
  if (ranked.length === 0) {
    return <p className="st-note">{branches.length === 0 ? "No branches reported yet." : "Everything is on its default branch."}</p>;
  }
  return (
    <div>
      {ranked.map((b) => (
        <div key={`${b.repo}/${b.name}`} className="flex items-center gap-2 px-1 py-1.5 min-h-11 md:min-h-0 text-xs">
          <Badge className="shrink-0">{b.repo}</Badge>
          <span className="font-mono text-ink-dim truncate min-w-0 flex-1">{b.name}</span>
          <span className="shrink-0 font-mono text-ink-faint tabular-nums">{b.commitDate ? relativeTime(b.commitDate) : "—"}</span>
        </div>
      ))}
    </div>
  );
}
