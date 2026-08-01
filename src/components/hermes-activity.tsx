/* THESIS: recent-first feed, same full-width hairline-header-plus-body band
   git-commit-stream.tsx uses. Kind badges reuse the app's existing badge
   vocabulary rather than inventing a fifth colour: digest is routine
   (neutral), alert is the one kind that means something's actually wrong
   (bad), recovery is good news (ok), ask is a person asking (blue) — the
   same "state colour only on a real distinction" rule DESIGN.md's badges
   section already enforces elsewhere. Rows with a body longer than a couple
   of lines expand in place (drive-health.tsx's disclosure idiom) rather than
   truncating silently. OWN-WORLD: nightwatch console. */
"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import type { HermesActivityItem, HermesActivityKind } from "@/lib/hermes-types";
import { cn } from "@/lib/utils";

const BODY_PREVIEW_LENGTH = 120;

function badgeVariantFor(kind: HermesActivityKind): NonNullable<BadgeProps["variant"]> {
  switch (kind) {
    case "digest":
      return "neutral";
    case "alert":
      return "bad";
    case "recovery":
      return "ok";
    case "ask":
      return "blue";
  }
}

function ActivityRow({ item }: { item: HermesActivityItem }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const expandable = item.body.length > BODY_PREVIEW_LENGTH || item.body.includes("\n");

  return (
    <div className="border-b border-line/50 last:border-0">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? panelId : undefined}
        disabled={!expandable}
        className={cn(
          "w-full text-left flex items-start gap-2.5 px-4 py-2.5 min-h-11 md:min-h-0",
          expandable ? "cursor-pointer hover:bg-panel-2/60" : "cursor-default",
        )}
      >
        <span className="font-mono text-xs text-ink-faint tabular-nums shrink-0 w-14 pt-0.5" title={item.at}>
          {relativeTime(item.at)}
        </span>
        <Badge variant={badgeVariantFor(item.kind)} className="shrink-0 mt-0.5">
          {item.kind}
        </Badge>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink truncate">{item.title || "(no title)"}</span>
          {!open && (
            <span className="block text-xs text-ink-dim truncate">{item.body}</span>
          )}
        </span>
        {expandable && (
          <ChevronDown
            size={13}
            className={cn(
              "text-ink-faint shrink-0 mt-1 transition-transform duration-200 ease-out motion-reduce:transition-none",
              open && "rotate-180",
            )}
            aria-hidden
          />
        )}
      </button>
      {expandable && open && (
        <div id={panelId} className="px-4 pb-3 -mt-1">
          <div className="logbox rounded-md border border-line bg-panel-2 px-3 py-2.5 text-ink-dim whitespace-pre-wrap break-words">
            {item.body}
          </div>
        </div>
      )}
    </div>
  );
}

export function HermesActivityFeed({ items }: { items: HermesActivityItem[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-line">
        <span className="microlabel">activity</span>
        <span className="font-mono text-xs text-ink-faint tabular-nums">
          {items.length === 0 ? "—" : `${items.length} recent`}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-6 text-xs text-ink-faint">
          nothing recorded yet — hermes has been quiet
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto">
          {items.map((item, i) => (
            // Composite key: the daemon's own contract carries no id field, and
            // (at, kind) alone can collide if two events land in the same
            // second — index breaks the tie without claiming a stable identity
            // the API doesn't offer.
            <ActivityRow key={`${item.at}-${item.kind}-${i}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
