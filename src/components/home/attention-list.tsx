"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FixSheet, type FixDone } from "@/components/home/fix-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AttentionReport } from "@/lib/attention-report";
import { fixFor, stillFailing } from "@/lib/fix-sheet";
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
  const [openId, setOpenId] = useState<string | null>(null);
  // A fix that went through, per row id, until the id leaves `live` (stops a second tap while the hit lingers).
  const [doneAt, setDoneAt] = useState<ReadonlyMap<string, FixDone>>(new Map());
  const headingRef = useRef<HTMLHeadingElement | null>(null);
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
    if (rankerRef.current.offer(ids, Date.now(), held || openId !== null)) {
      if (shown !== null) snapshot();
      setRankedLive(rankerRef.current.order!.slice());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, held, shown, openId]);

  // A later check that still lists the hit re-arms the action; a done entry for an id that left `live` is dropped.
  useEffect(() => {
    if (!report) return;
    const liveSet = new Set(live);
    setDoneAt((m) => {
      let next: Map<string, FixDone> | null = null;
      for (const [id, d] of m) {
        if (!liveSet.has(id)) (next ??= new Map(m)).delete(id);
        else if (d.still === undefined && stillFailing(d.at, report.checkedAt, true)) (next ??= new Map(m)).set(id, { at: d.at, still: clock(report.checkedAt) });
      }
      return next ?? m;
    });
  }, [report, live]);

  // The open row left the display (the pill tap dropped it): close, and put focus on the section heading.
  const displayHasOpen = openId !== null && display.includes(openId);
  useEffect(() => {
    if (openId !== null && !displayHasOpen) {
      setOpenId(null);
      headingRef.current?.focus();
    }
  }, [openId, displayHasOpen]);

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
        <h2 className="microlabel" ref={headingRef} tabIndex={-1}>
          Needs you
        </h2>
        <span className="font-mono text-xs text-ink-dim">{display.length}</span>
        <span className="flex-1" />
        {/* Always in the DOM: its slot is reserved from first paint, so it never moves anything. */}
        <Button
          variant="ghost"
          size="sm"
          className="hm-pill"
          data-on={pill ? "" : undefined}
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
            const fix = fixFor(r);
            const open = fix !== null && openId === id;
            return (
              <li
                key={id}
                className="hm-att-row"
                data-row-id={id}
                data-subject={r.subject}
                data-resolved={resolved ? "" : undefined}
                onKeyDown={
                  open
                    ? (e) => {
                        if (e.key !== "Escape") return;
                        setOpenId(null);
                        els.current.get(id)?.querySelector<HTMLElement>(".hm-att-disclose")?.focus();
                      }
                    : undefined
                }
                ref={(el) => {
                  if (el) els.current.set(id, el);
                  else els.current.delete(id);
                }}
              >
                <span className={cn("dot", resolved ? "dot-running" : SEV_DOT[r.severity])} aria-hidden />
                <div className="hm-att-body">
                  <div className="hm-att-head">
                    {fix ? (
                      <button
                        type="button"
                        className="dk-disclose hm-att-disclose"
                        aria-expanded={open}
                        aria-controls={open ? `hm-fix-${id}` : undefined}
                        onClick={() => setOpenId(open ? null : id)}
                      >
                        <ChevronDown size={14} aria-hidden className={cn("dk-chev", open && "dk-chev-open")} />
                        <span className="hm-att-title">{r.headline}</span>
                      </button>
                    ) : (
                      <span className="hm-att-title">{r.headline}</span>
                    )}
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
                {open && (
                  <FixSheet
                    id={id}
                    fix={fix}
                    resolved={resolved}
                    done={doneAt.get(id) ?? null}
                    onDone={(at) => setDoneAt((m) => new Map(m).set(id, { at }))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
