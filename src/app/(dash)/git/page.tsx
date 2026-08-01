"use client";

import { useGit } from "@/lib/use-forgejo";
import { GitStatusPanel } from "@/components/git-status-panel";
import { GitCommitStream } from "@/components/git-commit-stream";
import { GitBranchesPanel } from "@/components/git-branches-panel";
import { GitMirrorPanel } from "@/components/git-mirror-panel";

function GitLoadingSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="panel h-64 animate-pulse motion-reduce:animate-none bg-panel-2/40" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel h-48 animate-pulse motion-reduce:animate-none bg-panel-2/40" />
        <div className="panel h-48 animate-pulse motion-reduce:animate-none bg-panel-2/40" />
      </div>
    </div>
  );
}

export default function GitPage() {
  const { data, error } = useGit();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Git</h1>
        <p className="text-xs text-ink-dim mt-0.5">
          {data?.status === "ok"
            ? `${data.repos.length} ${data.repos.length === 1 ? "repo" : "repos"} on ${data.forgejoUrl}`
            : "self-hosted commit stream · local → GitHub mirror sync"}
        </p>
      </header>

      {error && <div className="panel p-4 text-bad text-sm">{error.message}</div>}

      {!data && !error && <GitLoadingSkeleton />}

      {data && data.status !== "ok" && <GitStatusPanel snapshot={data} />}

      {data && data.status === "ok" && data.repos.length === 0 && (
        <div className="panel p-6 text-center text-sm space-y-1">
          <p className="text-ink-faint">no repos yet — this Forgejo instance is empty.</p>
          <a
            href={data.forgejoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline font-mono text-xs"
          >
            {data.forgejoUrl}
          </a>
        </div>
      )}

      {data && data.status === "ok" && data.repos.length > 0 && (
        <>
          <GitCommitStream stream={data.stream} repoCount={data.repos.length} />
          <div className="grid gap-4 md:grid-cols-2 items-start">
            <GitBranchesPanel pulls={data.pulls} branches={data.branches} />
            <GitMirrorPanel mirrors={data.mirrors} />
          </div>
        </>
      )}
    </div>
  );
}
