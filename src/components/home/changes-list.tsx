"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AttentionReport } from "@/lib/attention-report";
import { clock, dropListed, feedSlots } from "@/lib/home";
import { createRanker } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

/**
 * "Since you last looked". R2, no growth: a fixed box of S slots (4, or the count at the "Show N more" tap).
 * New events fill slots in place, newest first, through the Ranker (one commit per 4 s, none while held).
 */
export function ChangesList({
  changes,
  hiddenNames,
  listed,
  sinceMs,
  fallbackLabel,
  error,
}: {
  changes: AttentionReport["changes"] | null;
  /** Containers the owner hid from the launcher: their events are dropped here, where `tile.hidden` is known. */
  hiddenNames: ReadonlySet<string>;
  /** Subjects already listed in Needs you (R3). */
  listed: ReadonlySet<string>;
  sinceMs: number | null;
  fallbackLabel: boolean;
  /** The attention report fetch failed: never show a loading sentence after that. */
  error: boolean;
}) {
  const events = useMemo(
    () =>
      dropListed(changes?.events ?? [], listed).filter(
        (e) => !(e.subjects.length > 0 && e.subjects.every((s) => hiddenNames.has(s.replace(/^container:/, "")))),
      ),
    [changes, hiddenNames, listed],
  );
  const [open, setOpen] = useState(false);
  const [openS, setOpenS] = useState(0);
  const [held, setHeld] = useState(false);
  const [committed, setCommitted] = useState<string[]>([]);
  const rankerRef = useRef(createRanker());
  const slots = feedSlots(events, open, openS);
  const idsKey = slots.ids.join("|");

  useEffect(() => {
    if (rankerRef.current.offer(slots.ids, Date.now(), held, true)) setCommitted(rankerRef.current.order!.slice());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, held]);

  function toggle() {
    const nextOpen = !open;
    const next = feedSlots(events, nextOpen, events.length);
    // The tap beats the hold: a fresh ranker's first offer always commits.
    const fresh = createRanker();
    fresh.offer(next.ids, Date.now(), false);
    rankerRef.current = fresh;
    setCommitted(next.ids);
    setOpenS(events.length);
    setOpen(nextOpen);
  }

  const byId = new Map(events.map((e) => [e.id, e]));
  const rows = committed.flatMap((id) => byId.get(id) ?? []).slice(0, slots.S);
  const showMore = slots.overflow > 0 || open;
  const when = sinceMs === null ? "" : clock(sinceMs);

  return (
    <section className="hm-chg" data-feature="changes" aria-label="Since you last looked">
      <div className="hm-sec-head">
        <h2 className="microlabel">
          {fallbackLabel ? "Last 24 h" : `Since you last looked · ${when}`}
          {changes?.status === "failed" ? " · app changes unknown" : ""}
        </h2>
      </div>
      <ul
        className="hm-chg-list"
        role="list"
        style={{ "--hm-chg-rows": slots.S } as React.CSSProperties}
        data-slots={rows.map((e) => e.id).join(" ")}
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
        }}
      >
        {rows.map((e) => (
          <li
            key={e.id}
            className="hm-chg-row"
            data-row-id={e.id}
            data-kind={e.kind}
            data-subject={e.subjects.join(" ")}
          >
            <span className="hm-chg-at font-mono text-xs text-ink-dim">{clock(e.at)}</span>
            <span className="hm-chg-text" title={e.text}>
              {e.text}
            </span>
            <Link
              href={e.owner.href}
              aria-label={`${e.text}: ${e.owner.label}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hm-chg-owner")}
            >
              {e.owner.label}
            </Link>
          </li>
        ))}
        {events.length === 0 && (
          <li className="hm-chg-empty text-xs text-ink-dim">
            {changes ? `Nothing changed since ${when || "the last look"}.` : error ? "Unknown." : "Looking for changes…"}
          </li>
        )}
      </ul>
      {/* Its slot is always there: it never toggles `hidden`, so the page cannot move. */}
      <Button
        variant="ghost"
        size="sm"
        className="hm-more"
        style={{ visibility: showMore ? "visible" : "hidden" }}
        tabIndex={showMore ? 0 : -1}
        aria-hidden={showMore ? undefined : true}
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? "Show fewer" : `Show ${slots.overflow} more`}
      </Button>
    </section>
  );
}
