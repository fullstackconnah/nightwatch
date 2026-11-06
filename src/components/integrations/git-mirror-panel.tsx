"use client";

/* THESIS: the Mirrors strip's detail, one row per push mirror with its own Sync now. Sync now only asks Forgejo to push
   now, so it never asks first; it says "Syncing…" in flight and "Sync requested." for a few seconds after. A mirror's
   error line is redacted by the page model (no address, URL or host). OWN-WORLD: nightwatch console. */
import { useEffect, useState } from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { WriteAction } from "@/components/strips/write-action";
import { relativeTime } from "@/lib/format";
import { divergence, safeLine } from "@/lib/git/page-model";
import { syncMirror } from "@/lib/use-forgejo";
import type { GitMirror } from "@/lib/types/forgejo";

/**
 * Threshold Rule: a mirror sitting in sync is the NORMAL state, not an achievement, so it gets the neutral badge rather
 * than `ok` green. Diverged is a real threshold and earns warn; an actual sync error earns bad.
 */
function stateBadge(m: GitMirror): { variant: NonNullable<BadgeProps["variant"]>; text: string } {
  if (m.lastError) return { variant: "bad", text: "error" };
  if (m.defaultBranch.state === "diverged") return { variant: "warn", text: "diverged" };
  return { variant: "neutral", text: "synced" };
}

function SyncNow({ mirror, enabled }: { mirror: GitMirror; enabled: boolean }) {
  const [requested, setRequested] = useState(false);
  const [owner, repo] = mirror.repo.split("/");
  useEffect(() => {
    if (!requested) return;
    const t = setTimeout(() => setRequested(false), 4000);
    return () => clearTimeout(t);
  }, [requested]);
  return (
    <div className="flex flex-col items-end gap-1">
      <WriteAction
        label="Sync now"
        ariaLabel={`Sync ${mirror.repo} now`}
        confirm={false}
        flight="Syncing…"
        failure={`Couldn’t sync ${mirror.repo}`}
        disabled={!enabled}
        triggerClassName="h-11 md:h-8"
        run={async () => {
          await syncMirror(owner, repo);
          setRequested(true);
        }}
      />
      {requested && <span role="status" className="text-[0.7rem] text-ink-dim">Sync requested.</span>}
    </div>
  );
}

export function MirrorRows({ mirrors, enabled, forgejoUrl }: { mirrors: GitMirror[]; enabled: boolean; forgejoUrl: string }) {
  if (mirrors.length === 0) return <p className="st-note">No push mirrors are configured.</p>;
  return (
    <div>
      {mirrors.map((m) => {
        const badge = stateBadge(m);
        const note = m.lastError ? safeLine(m.lastError, forgejoUrl) : divergence(m);
        return (
          <div key={m.repo} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 border-b border-line/50 last:border-0">
            <div className="min-w-0 flex-1 basis-56 space-y-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-sm text-ink truncate min-w-0">{m.repo}</span>
                <Badge variant={badge.variant} className="shrink-0">{badge.text}</Badge>
              </div>
              <div className="font-mono text-xs text-ink-dim truncate" title={m.target}>{m.target}</div>
              <div className="font-mono text-xs text-ink-faint">last sync {m.lastSync ? relativeTime(m.lastSync) : "never"}</div>
              {note && <div className={m.lastError ? "text-xs text-bad break-words" : "text-xs text-ink-faint"}>{note}</div>}
            </div>
            <SyncNow mirror={m} enabled={enabled} />
          </div>
        );
      })}
    </div>
  );
}
