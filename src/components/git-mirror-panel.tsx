"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { syncMirror } from "@/lib/use-forgejo";
import type { GitMirror } from "@/lib/forgejo-types";

/**
 * Threshold Rule: a mirror sitting in sync is the NORMAL state, not an
 * achievement, so it gets the neutral badge rather than `ok` green — green
 * is reserved for a real "this crossed a threshold and it's good" moment,
 * which "nothing has diverged" isn't. Diverged is a real threshold (the
 * branches disagree) and earns warn; an actual sync error earns bad.
 */
function stateBadge(m: GitMirror): { variant: NonNullable<BadgeProps["variant"]>; text: string } {
  if (m.lastError) return { variant: "bad", text: "error" };
  if (m.defaultBranch.state === "diverged") return { variant: "warn", text: "diverged" };
  return { variant: "neutral", text: "synced" };
}

function divergenceNote(m: GitMirror): string | null {
  if (m.defaultBranch.state !== "diverged") return null;
  const { aheadBy, behindBy } = m.defaultBranch;
  if (aheadBy == null && behindBy == null) return "default branch diverged";
  const parts: string[] = [];
  if (aheadBy) parts.push(`+${aheadBy} ahead`);
  if (behindBy) parts.push(`-${behindBy} behind`);
  return parts.length ? parts.join(" · ") : "default branch diverged";
}

type SyncState = "idle" | "pending" | "ok" | "error";

function SyncButton({ mirror }: { mirror: GitMirror }) {
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [owner, repo] = mirror.repo.split("/");

  async function run() {
    setState("pending");
    setMessage(null);
    try {
      await syncMirror(owner, repo);
      setState("ok");
      setMessage("sync requested");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "sync request failed");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state === "pending"}
        className="h-11 md:h-8 px-2.5 rounded-md text-ink-dim hover:text-ink hover:bg-panel-2 disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-1.5 text-xs cursor-pointer transition-colors"
      >
        {state === "pending" && <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />}
        {state === "pending" ? "syncing…" : "sync now"}
      </button>
      {message && (
        <span className={cn("text-[0.65rem]", state === "error" ? "text-bad" : "text-ink-dim")}>{message}</span>
      )}
    </div>
  );
}

export function GitMirrorPanel({ mirrors }: { mirrors: GitMirror[] }) {
  if (mirrors.length === 0) {
    return (
      <div className="space-y-2">
        <span className="microlabel">mirror sync</span>
        <div className="panel p-6 text-center text-ink-faint text-sm">no push mirrors configured</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <span className="microlabel">mirror sync</span>

      <div className="panel overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Repo", "Target", "Last sync", "Status", ""].map((h) => (
                <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mirrors.map((m) => {
              const badge = stateBadge(m);
              const note = divergenceNote(m);
              return (
                <tr key={m.repo} className="border-b border-line/50 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-ink">{m.repo}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-dim max-w-56 truncate" title={m.target}>
                    {m.target}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-faint whitespace-nowrap">
                    {m.lastSync ? relativeTime(m.lastSync) : "never"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={badge.variant}>{badge.text}</Badge>
                    {m.lastError && (
                      <div className="font-mono text-[0.65rem] text-bad mt-1 max-w-56 truncate" title={m.lastError}>
                        {m.lastError}
                      </div>
                    )}
                    {!m.lastError && note && <div className="text-[0.65rem] text-ink-faint mt-1">{note}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <SyncButton mirror={m} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        {mirrors.map((m) => {
          const badge = stateBadge(m);
          const note = divergenceNote(m);
          return (
            <div key={m.repo} className="panel p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-ink truncate min-w-0">{m.repo}</span>
                <Badge variant={badge.variant} className="shrink-0">
                  {badge.text}
                </Badge>
              </div>
              <div className="font-mono text-xs text-ink-dim truncate" title={m.target}>
                {m.target}
              </div>
              <div className="font-mono text-xs text-ink-faint">
                last sync {m.lastSync ? relativeTime(m.lastSync) : "never"}
              </div>
              {m.lastError && <div className="font-mono text-xs text-bad break-words">{m.lastError}</div>}
              {!m.lastError && note && <div className="text-xs text-ink-faint">{note}</div>}
              <div className="flex justify-end">
                <SyncButton mirror={m} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
