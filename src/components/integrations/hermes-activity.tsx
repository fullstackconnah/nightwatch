/* THESIS: recent-first feed, the Activity strip's detail (held while the strips are held, R5). Kind badges reuse the app's existing badge
   vocabulary rather than inventing a fifth colour: digest is routine
   (neutral), alert is the one kind that means something's actually wrong
   (bad), recovery is good news (ok), ask is a person asking (blue) — the
   same "state colour only on a real distinction" rule DESIGN.md's badges
   section already enforces elsewhere. Rows with a body longer than a couple
   of lines expand in place (drive-health.tsx's disclosure idiom) rather than
   truncating silently. OWN-WORLD: nightwatch console. */
"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { useHeldList } from "@/components/strips/strip-list";
import { relativeTime } from "@/lib/format";
import type { HermesActivityItem, HermesActivityKind } from "@/lib/types/hermes";
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
          "w-full text-left flex items-start gap-2.5 py-2.5 min-h-11 md:min-h-0",
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
        <div id={panelId} className="pb-3 -mt-1">
          <div className="logbox rounded-md border border-line bg-panel-2 px-3 py-2.5 text-ink-dim whitespace-pre-wrap break-words">
            {item.body}
          </div>
        </div>
      )}
    </div>
  );
}

/** One id per item for the held list: (at, kind) can collide inside one second, so repeats get a counter. */
function withIds(items: HermesActivityItem[]) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = `${item.at}|${item.kind}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { id: n ? `${base}#${n}` : base, item };
  });
}

/** Activity rows (30 s poll). While the strips are held (pointer or focus inside) rows stay put and new ones wait behind "N new · show" (R5). */
export function HermesActivityFeed({ items }: { items: HermesActivityItem[] }) {
  const live = withIds(items);
  const h = useHeldList(live.map((x) => x.id));
  const known = useRef(new Map<string, HermesActivityItem>());
  for (const x of live) known.current.set(x.id, x.item);
  if (items.length === 0 && h.rows.length === 0) {
    return <p className="st-note">Nothing recorded yet. Hermes has been quiet.</p>;
  }
  return (
    <div>
      <div className="st-listhead">
        <span>{items.length} recent</span>
        <button type="button" className="st-pill" data-on={h.pill ? "" : undefined} tabIndex={h.pill ? 0 : -1} onClick={h.show}>
          {h.pill || "0 new · show"}
        </button>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        {h.rows.map((id) => {
          const item = known.current.get(id);
          return item && <ActivityRow key={id} item={item} />;
        })}
      </div>
    </div>
  );
}
