"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AttentionReport } from "@/lib/attention-report";
import { calmLine, clock, gate, homeRows, pillText, reveal, slotOrder, type HomeRow } from "@/lib/home";
import { createRanker } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

const SEV_DOT = { bad: "dot-dead", warn: "dot-unhealthy" } as const;

/**
 * "Needs you". R1, the pill rule: after first paint a new row never enters by itself, it waits behind the pill.
 * A cleared row keeps its slot, same height, in the resolved look until the tap. Only a tap, or a Ranker reorder
 * of the committed live rows (never while held), changes what is listed.
 */
export function AttentionList({
  report,
  error,
  onListed,
}: {
  report: AttentionReport | null;
  error: boolean;
  /** The subjects of every row listed, resolved ones included, so the changes list does not repeat them (R3). */
  onListed?: (subjects: ReadonlySet<string>) => void;
}) {
  const rows = useMemo(() => (report ? homeRows(report) : []), [report]);
  const live = useMemo(() => rows.map((r) => r.id), [rows]);
  const [shown, setShown] = useState<string[] | null>(null);
  const [rankedLive, setRankedLive] = useState<string[]>([]);
  const [held, setHeld] = useState(false);
  const rankerRef = useRef(createRanker());
  const cache = useRef(new Map<string, HomeRow>());
  const goneAt = useRef(new Map<string, number>());
  const els = useRef(new Map<string, HTMLLIElement>());
  const listRef = useRef<HTMLUListElement | null>(null);
  const before = useRef<Map<string, number> | null>(null);

  const g = gate(report ? shown : null, live);
  const checkedAt = report ? Date.parse(report.checkedAt) : 0;
  // Idempotent bookkeeping: last-known row data for the ids that went away, and when we noticed.
  for (const r of rows) {
    cache.current.set(r.id, r);
    goneAt.current.delete(r.id);
  }
  for (const id of g.fixed) if (!goneAt.current.has(id)) goneAt.current.set(id, checkedAt);

  const shownSet = new Set(g.shown);
  const liveShown = live.filter((id) => shownSet.has(id));
  const liveShownSet = new Set(liveShown);
  const ranked = rankedLive.filter((id) => liveShownSet.has(id));
  for (const id of liveShown) if (!ranked.includes(id)) ranked.push(id);
  const display = slotOrder(g.shown, new Set(g.fixed), ranked);
  const displayKey = display.join("|");
  const subjectsKey = display.map((id) => cache.current.get(id)?.subject ?? "").join("|");
  useEffect(() => {
    onListed?.(new Set(subjectsKey.split("|").filter(Boolean)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectsKey]);

  /** Rects relative to the list, so scrolling cannot fake a move. getBoundingClientRect includes a running transform. */
  function snapshot() {
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    before.current = new Map([...els.current].map(([id, el]) => [id, el.getBoundingClientRect().top - top]));
  }

  // First paint commits everything; later offers go through the Ranker (4 s gap, none while held).
  useEffect(() => {
    if (!report) return;
    if (shown === null) setShown(live);
    const ids = shown === null ? live : liveShown;
    if (rankerRef.current.offer(ids, Date.now(), held)) {
      if (shown !== null) snapshot();
      setRankedLive(rankerRef.current.order!.slice());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, held, shown]);

  // The slide (FLIP): rows that changed place move from where they were; rows that entered fade in.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (!was || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    for (const [id, el] of els.current) {
      const from = was.get(id);
      if (from === undefined) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
        continue;
      }
      const dy = from - (el.getBoundingClientRect().top - top);
      if (dy !== 0) {
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
          duration: 420,
          easing: "cubic-bezier(.2, .8, .2, 1)",
        });
      }
    }
  }, [displayKey]);

  function tap() {
    snapshot();
    const next = reveal(live);
    setShown(next);
    // A fresh ranker: its first offer always commits, so the tap beats the hold.
    const fresh = createRanker();
    fresh.offer(next, Date.now(), false);
    rankerRef.current = fresh;
    setRankedLive(next);
  }

  const pill = pillText(g.waiting.length, g.fixed.length);
  const at = report ? clock(report.checkedAt) : "";
  const calm = !report && !error ? "Checking…" : calmLine(report, g.waiting.length, at);

  return (
    <section
      className="hm-att"
      data-feature="attention"
      aria-label="Needs you"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className="hm-sec-head">
        <h2 className="microlabel">Needs you</h2>
        <span className="font-mono text-xs text-ink-dim">{display.length}</span>
        <span className="flex-1" />
        {/* Always in the DOM: its slot is reserved from first paint, so it never moves anything. */}
        <Button
          variant="ghost"
          size="sm"
          className="hm-pill"
          style={{ visibility: pill ? "visible" : "hidden" }}
          tabIndex={pill ? 0 : -1}
          aria-hidden={pill ? undefined : true}
          onClick={tap}
        >
          {pill || "0 new · show"}
        </Button>
      </div>
      {display.length === 0 ? (
        <p className="hm-att-calm">{calm}</p>
      ) : (
        <ul className="hm-att-list" role="list" ref={listRef}>
          {display.map((id) => {
            const r = cache.current.get(id);
            if (!r) return null;
            const resolved = goneAt.current.has(id);
            return (
              <li
                key={id}
                className="hm-att-row"
                data-row-id={id}
                data-subject={r.subject}
                data-resolved={resolved ? "" : undefined}
                ref={(el) => {
                  if (el) els.current.set(id, el);
                  else els.current.delete(id);
                }}
              >
                <span className={cn("dot", resolved ? "dot-running" : SEV_DOT[r.severity])} aria-hidden />
                <div className="hm-att-body">
                  <div className="hm-att-head">
                    <span className="hm-att-title">{r.headline}</span>
                    <span className="hm-att-since font-mono">
                      {resolved ? `fixed ${clock(goneAt.current.get(id)!)}` : `since ${clock(r.since)}`}
                    </span>
                  </div>
                  {r.detail && <p className="hm-att-detail">{r.detail}</p>}
                  {r.action && <p className="hm-att-action">{r.action}</p>}
                </div>
                <Link href={r.owner.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "hm-att-owner")}>
                  {r.owner.label}
                  <ChevronRight size={12} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
