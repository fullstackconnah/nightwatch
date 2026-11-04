"use client";

/* One AI lane as a strip: identity and state, one attention line, four reserved agent slots, and a Details
   disclosure whose body is fetched only while open. Lanes never move. The strip's agents are held from first
   paint: a join or leave waits behind the pill until it is tapped, then the slots FLIP into place. The words
   (badge, attention line) read every agent in flight, held or not. Stale mode (service unreachable, showing the
   last snapshot) drops the disclosure and every mark: no live state exists to mark. */

import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import {
  agentLook,
  checkpointView,
  formatQuiet,
  holdMembers,
  holdPillText,
  inFlightRows,
  laneAttention,
  laneBadge,
  laneRowId,
  laneStuck,
  slotLayout,
  stallFill,
} from "@/lib/orchestra-view";
import { useOrchestraDetail } from "@/lib/use-orchestra";
import type { OrchestraDetailResponse, OrchestratorInFlight, OrchestratorSummary } from "@/lib/types/orchestra";
import { SkeletonBar } from "@/components/integrations/orchestra-status";

const EASE = "cubic-bezier(.2,.8,.2,1)"; // --ease-calm; the Web Animations API takes no var()

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="microlabel">{label}</div>
      {items.length === 0 ? (
        <div className="font-mono text-[0.65rem] text-ink-dim">none</div>
      ) : (
        items.map((i) => (
          <div key={i} className="font-mono text-[0.65rem] text-ink-dim [overflow-wrap:anywhere]">
            {i}
          </div>
        ))
      )}
    </div>
  );
}

function DetailBody({ data, error, loading, onRetry }: {
  data: OrchestraDetailResponse | undefined;
  error: unknown;
  loading: boolean;
  onRetry: () => void;
}) {
  const detail = data?.status === "ok" ? data.orchestrator : null;
  if (detail) {
    const cp = checkpointView(detail.checkpoint);
    const rows = inFlightRows(detail.inFlight);
    return (
      <>
        <div className="space-y-1">
          <div className="microlabel">checkpoint</div>
          <p data-checkpoint="" className={`whitespace-pre-line text-xs [overflow-wrap:anywhere] ${cp.empty ? "text-ink-dim" : "text-ink"}`}>{cp.text}</p>
          {cp.cut && <p className="text-[0.65rem] text-ink-faint">The service keeps the first 300 characters.</p>}
        </div>
        <div className="space-y-1">
          <div className="microlabel">in flight</div>
          {rows.length === 0 ? (
            <p className="text-xs text-ink-dim">Idle: nothing in flight.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.name} className="flex min-h-8 items-center justify-between gap-2">
                  <span className="min-w-0 font-mono text-xs text-ink [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {r.waiting && <Badge variant="warn" data-mark="">waiting</Badge>}
                    {r.stalled && <Badge variant="warn" data-mark="">stalled</Badge>}
                    <span data-mark={r.stalled ? "" : undefined} className={`font-mono text-xs ${r.stalled ? "text-warn" : "text-ink-dim"}`}>{formatQuiet(r.quietMin)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {detail.sessionId && (
          <div className="space-y-1">
            <div className="microlabel">session</div>
            <div title={detail.sessionId} className="block truncate font-mono text-[0.7rem] text-ink-dim">{detail.sessionId}</div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <List label="extra dirs" items={detail.addDirs} />
          <List label="plugins" items={detail.plugins} />
        </div>
      </>
    );
  }
  if (loading && !error && !data) {
    return (
      <div className="space-y-2" aria-busy="true">
        <SkeletonBar delayMs={0} className="w-2/3" />
        <SkeletonBar delayMs={60} className="w-full" />
      </div>
    );
  }
  const gone = (error instanceof ApiError && error.status === 404) || (data?.status === "ok" && !data.orchestrator);
  const why = gone
    ? "This orchestrator is no longer in the registry."
    : data && data.status !== "ok"
      ? data.detail
      : error instanceof Error
        ? error.message
        : "";
  return (
    <div className="space-y-2">
      <p data-mark="" className="text-xs text-bad">Could not load details.</p>
      {why && <p className="text-[0.7rem] text-ink-dim">{why}</p>}
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** One agent slot: name (wraps, never cut), quiet text, mark badge, and the 2 px track toward the stall mark. */
function AgentSlot({ lane, id, agent, left, stale }: { lane: string; id: string; agent: OrchestratorInFlight; left: boolean; stale: boolean }) {
  // Stale or finished: no live reading, so no mark and a neutral track.
  const look = left || stale ? "quiet" : agentLook(agent);
  const marked = look !== "quiet";
  const quiet: ReactNode = left ? "" : look === "waiting" && agent.waiting ? (
    <>
      {"waiting "}
      <span className="ol-min">{agent.waiting.sinceMin}m</span>
    </>
  ) : formatQuiet(agent.quietMin);
  const markText = left ? "finished" : look === "quiet" ? "" : look;
  return (
    <li className="or-agent" data-row-id={id} data-kind="agent" data-lane={lane} data-left={left ? "" : undefined} tabIndex={-1}>
      <span className="or-aname font-mono">{agent.name}</span>
      <span className="or-quiet font-mono">{quiet}</span>
      <span className="or-badge or-mark" data-mark={marked ? "" : undefined} data-off={markText === "" ? "" : undefined}>
        {markText}
      </span>
      <span className="ol-track" aria-hidden="true">
        <span className="ol-fill" data-mark={marked ? "" : undefined} style={{ transform: `scaleX(${stallFill(agent.quietMin)})` }} />
      </span>
    </li>
  );
}

export function LaneStrip({ o, stale }: { o: OrchestratorSummary; stale: boolean }) {
  const uid = useId();
  const badge = laneBadge(o, stale);
  const att = laneAttention(o, stale);
  const live = o.inFlight;
  const names = live.map((a) => a.name);

  // The hold: membership is fixed at first paint. `seen` keeps the last reading of an agent that left.
  const [held, setHeld] = useState<string[]>(names);
  const seen = useRef(new Map<string, OrchestratorInFlight>());
  live.forEach((a) => seen.current.set(a.name, a));
  const m = holdMembers(held, names);
  const slots = slotLayout(o.name, held);

  // A stuck lane starts open so the anomaly shows which agents without a tap; the owner's own choice then holds.
  const [chosen, setChosen] = useState<boolean>(() => laneStuck(o));
  const open = !stale && chosen;
  const { data, error, isLoading, mutate } = useOrchestraDetail(o.name, open);
  const detailId = `${uid}-detail`;

  const listRef = useRef<HTMLUListElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const from = useRef<Map<string, DOMRect> | null>(null);

  function commit() {
    const rects = new Map<string, DOMRect>();
    listRef.current?.querySelectorAll<HTMLElement>("[data-row-id]").forEach((e) => rects.set(e.dataset.rowId ?? "", e.getBoundingClientRect()));
    from.current = rects;
    setHeld(names);
  }

  // FLIP after a commit: slots that stay slide from where they were (transform only), new ones fade in.
  useLayoutEffect(() => {
    const before = from.current;
    if (!before) return;
    from.current = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let first: HTMLElement | null = null;
    listRef.current?.querySelectorAll<HTMLElement>("[data-row-id]").forEach((e) => {
      if (e.dataset.kind === "free") return;
      const prev = before.get(e.dataset.rowId ?? "");
      if (!prev) {
        first ??= e;
        e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE });
        return;
      }
      if (reduced) return;
      const now = e.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 420, easing: EASE });
    });
    ((first as HTMLElement | null) ?? nameRef.current)?.focus();
  }, [held]);

  const meta = [o.model, o.home, o.lastActivityAt ? `active ${relativeTime(o.lastActivityAt)}` : "no activity yet"].filter((x): x is string => Boolean(x));
  const pillOn = m.fresh + m.left > 0;

  return (
    <li className="ol-strip panel" data-row-id={laneRowId(o.name)} aria-labelledby={`${uid}-name`}>
      <div className="ol-ctrl" aria-hidden="true" />
      <div className="ol-main">
        <div className="or-head">
          <span className={`dot ${badge.dot}`} data-mark={badge.mark ? "" : undefined} aria-hidden />
          <h2 id={`${uid}-name`} ref={nameRef} tabIndex={-1} className="or-lname font-mono outline-none">{o.name}</h2>
          {o.title && <span className="or-ltitle" title={o.title}>{o.title}</span>}
          <span className="or-badge" data-state-badge="" data-tone={badge.tone === "ok" ? "ok" : undefined} data-mark={badge.mark ? "" : undefined}>
            {badge.text}
          </span>
        </div>
        <p className="or-meta">
          {meta.map((x, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="or-sep" aria-hidden="true" />}
              <span className={x === o.home ? "or-home font-mono" : undefined}>{x}</span>
            </Fragment>
          ))}
        </p>
      </div>
      <div className="ol-foot">
        <Button variant="ghost" size="sm" className="ol-new" data-on={pillOn ? "" : undefined} tabIndex={pillOn ? 0 : -1} onClick={commit}>
          {holdPillText(m)}
        </Button>
      </div>

      <p className="ol-att or-att" data-tone={att.tone}>
        {att.who && att.text.startsWith(att.who) ? (
          <>
            <b className="or-who font-mono">{att.who}</b>
            {att.text.slice(att.who.length)}
          </>
        ) : (
          att.text
        )}
      </p>

      <div className="ol-slots">
        <ul ref={listRef} className="or-slots" aria-label={`${o.name} agents in flight`}>
          {slots.map((s) => {
            if (s.kind === "free") return <li key={s.id} className="or-agent or-free" data-row-id={s.id} data-kind="free" aria-hidden="true" />;
            if (s.kind === "more") {
              return (
                <li key={s.id} className="or-agent or-moreslot" data-row-id={s.id} data-kind="more">
                  <Button variant="ghost" size="sm" disabled={stale} aria-expanded={open} aria-controls={detailId} onClick={() => setChosen(true)}>
                    Show {s.n} more
                  </Button>
                </li>
              );
            }
            const agent = live.find((a) => a.name === s.name);
            const last = agent ?? seen.current.get(s.name);
            if (!last) return null;
            return <AgentSlot key={s.id} lane={o.name} id={s.id} agent={last} left={!agent} stale={stale} />;
          })}
        </ul>
      </div>

      <div className="ol-disc">
        {!stale && (
          <Button variant="ghost" size="sm" className="ol-disc-btn" aria-expanded={open} aria-controls={detailId} onClick={() => setChosen(!open)}>
            {open ? "Hide details" : "Details"}
            <ChevronDown size={14} className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          </Button>
        )}
        {open && (
          <div id={detailId} className="space-y-3 border-t border-line/60 pt-3">
            <DetailBody data={data} error={error} loading={isLoading} onRetry={() => void mutate()} />
            {data && <div className="microlabel">details checked {relativeTime(data.fetchedAt)}</div>}
          </div>
        )}
      </div>
    </li>
  );
}
