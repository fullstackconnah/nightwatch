/* The answer: one number for "how much can go", the bar that splits it, and a fixed-height status slot.
   The slot shows exactly one item (error, stale, sizes line, or the build-cache note), so a state change never moves the hero. */
"use client";

import { formatBytes } from "@/lib/format";
import { heroLine, type SlotKind } from "@/lib/docker-chores";
import { useCountTo } from "./motion";

export interface AnswerProps {
  loading: boolean;
  diskError: boolean;
  bytes: number;
  plus: boolean;
  segments: { dangling: number; orphans: number; unused: number; cache: number | null };
  sizesPending: boolean;
  slot: { kind: SlotKind; text: string } | null;
}

const LEGEND: { key: keyof AnswerProps["segments"]; label: string }[] = [
  { key: "dangling", label: "dangling images" },
  { key: "orphans", label: "orphan volumes" },
  { key: "unused", label: "unused tagged" },
  { key: "cache", label: "build cache" },
];

export function Answer(p: AnswerProps) {
  const counted = useCountTo(p.bytes);
  const hero = heroLine({ loading: p.loading, diskError: p.diskError, bytes: counted, plus: p.plus });
  const seg = (k: keyof AnswerProps["segments"]) => p.segments[k];
  const total = LEGEND.reduce((a, l) => a + (seg(l.key) ?? 0), 0) || 1; // null counts as 0 only here
  const showBar = !p.loading && !p.diskError;
  return (
    <section className="panel dk-answer" aria-labelledby="dk-hero">
      <h2 id="dk-hero" className="dk-hero">
        <span className="dk-num">{hero.lead}</span>
        {hero.label && <span className="dk-num-label"> {hero.label}</span>}
      </h2>
      {showBar ? (
        <div
          className="dk-bar"
          role="img"
          aria-label={LEGEND.map((l) => `${l.label} ${seg(l.key) == null ? "…" : formatBytes(seg(l.key) ?? 0, 1)}`).join(", ")}
        >
          {LEGEND.filter((l) => (seg(l.key) ?? 0) > 0).map((l) => (
            <span key={l.key} className="dk-seg" data-seg={l.key} style={{ flexGrow: (seg(l.key) ?? 0) / total }} />
          ))}
        </div>
      ) : (
        <div className="dk-bar dk-skel" aria-hidden />
      )}
      <ul className="dk-legend">
        {LEGEND.map((l) => (
          <li key={l.key} data-seg={l.key}>
            <span className="dk-sw" aria-hidden />
            <span>{l.label}</span>
            <span className="dk-leg-n font-mono">
              {!showBar || (l.key === "orphans" && p.sizesPending) ? "…" : seg(l.key) == null ? "…" : formatBytes(seg(l.key) ?? 0, 1)}
            </span>
          </li>
        ))}
      </ul>
      <div className="dk-slot" data-state={p.slot?.kind} role={p.slot?.kind === "error" ? "alert" : "status"}>
        {p.slot?.text}
      </div>
    </section>
  );
}
