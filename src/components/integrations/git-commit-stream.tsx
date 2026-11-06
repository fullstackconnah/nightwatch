"use client";

/* THESIS: the Commits strip's detail, recent-first across every repo. Rows hold while the strips are held and new ones
   wait behind "N new · show" (R5, R17). Each row links straight out to Forgejo's own commit diff. OWN-WORLD: nightwatch console. */
import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { useHeldList } from "@/components/strips/strip-list";
import { relativeTime } from "@/lib/format";
import type { GitCommitEntry } from "@/lib/types/forgejo";

export function GitCommitStream({ stream }: { stream: GitCommitEntry[] }) {
  const ids = stream.map((c) => `${c.repo}@${c.sha}`);
  const h = useHeldList(ids);
  const known = useRef(new Map<string, GitCommitEntry>());
  stream.forEach((c, i) => known.current.set(ids[i], c));
  if (stream.length === 0 && h.rows.length === 0) return <p className="st-note">No commits yet. Quiet is normal on a fresh instance.</p>;
  return (
    <div>
      <div className="st-listhead">
        <span>{stream.length} recent</span>
        <button type="button" className="st-pill" data-on={h.pill ? "" : undefined} tabIndex={h.pill ? 0 : -1} onClick={h.show}>
          {h.pill || "0 new · show"}
        </button>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        {h.rows.map((id) => {
          const c = known.current.get(id);
          return (
            c && (
              <a
                key={id}
                href={c.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-1 py-2 min-h-11 md:min-h-0 border-b border-line/50 last:border-0 hover:bg-panel-2/60 transition-colors"
              >
                <span className="font-mono text-xs text-ink-faint tabular-nums shrink-0 w-14" title={c.date}>{relativeTime(c.date)}</span>
                <Badge variant="accent" className="shrink-0">{c.repo}</Badge>
                <span className="min-w-0 flex-1 basis-40 text-ink text-sm truncate" title={c.message}>{c.message}</span>
                <span className="shrink-0 text-xs text-ink-dim truncate max-w-[9rem]" title={c.authorName}>{c.authorName}</span>
                <span className="shrink-0 font-mono text-[0.65rem] text-ink-faint">{c.shortSha}</span>
              </a>
            )
          );
        })}
      </div>
    </div>
  );
}
