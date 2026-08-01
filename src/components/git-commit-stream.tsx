import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import type { GitCommitEntry } from "@/lib/forgejo-types";

/**
 * Recent-first commit band across every repo — the same full-width
 * hairline-header-plus-body silhouette the log track and uplink band use
 * (DESIGN.md's "band" shape). Each row links straight out to Forgejo's own
 * commit diff, so this never tries to be a diff viewer itself.
 */
export function GitCommitStream({ stream, repoCount }: { stream: GitCommitEntry[]; repoCount: number }) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-line">
        <span className="microlabel">commit stream</span>
        <span className="font-mono text-xs text-ink-faint tabular-nums">
          {stream.length === 0 ? "—" : `${stream.length} recent`}
        </span>
      </div>

      <div className="max-h-[28rem] overflow-y-auto">
        {stream.length === 0 ? (
          <div className="px-4 py-6 text-xs text-ink-faint">
            {repoCount === 0
              ? "no repos yet"
              : `no commits yet across ${repoCount} ${repoCount === 1 ? "repo" : "repos"} — quiet is normal on a fresh instance.`}
          </div>
        ) : (
          stream.map((c) => (
            <a
              key={`${c.repo}@${c.sha}`}
              href={c.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 py-2 min-h-11 md:min-h-0 border-b border-line/50 last:border-0 hover:bg-panel-2/60 transition-colors"
            >
              <span className="font-mono text-xs text-ink-faint tabular-nums shrink-0 w-14" title={c.date}>
                {relativeTime(c.date)}
              </span>
              <Badge variant="accent" className="shrink-0">
                {c.repo}
              </Badge>
              <span className="min-w-0 flex-1 basis-40 text-ink text-sm truncate" title={c.message}>
                {c.message}
              </span>
              <span className="shrink-0 text-xs text-ink-dim truncate max-w-[9rem]" title={c.authorName}>
                {c.authorName}
              </span>
              <span className="shrink-0 font-mono text-[0.65rem] text-ink-faint">{c.shortSha}</span>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
