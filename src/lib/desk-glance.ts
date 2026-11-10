/* The desktop widget's glance (v1): a small, allowlisted view of the attention report.
 * Pure; relative or type-only imports so node:test can load it. */
import type { AttentionHit, AttentionReport } from "./attention-report.ts";
import { answerFor, type Tone } from "./home.ts";
import type { KioskVitalsData } from "./kiosk-vitals-view.ts";

export interface GlanceItem {
  id: string;
  severity: "warn" | "bad";
  headline: string;
  detail?: string;
  action?: string;
  since?: string;
  href: string;
}
export interface Glance {
  v: 1;
  checkedAt: string;
  tone: Tone;
  answer: string;
  /** The orchestra hit (0 or 1; its id is constant), lifted out of the ranking so a stuck lane shows first. */
  lanes: GlanceItem[];
  items: GlanceItem[];
  probes: { answered: number; failed: number; pending: number };
  vitals: { cpu: number; mem: number; diskMax: number | null } | null;
}

// Copy field by field: a hit may carry more than it declares, and none of it may leave the box.
function toItem(h: AttentionHit): GlanceItem {
  const item: GlanceItem = {
    id: h.id,
    severity: h.severity,
    headline: h.headline,
    href: h.owner.href.startsWith("/") ? h.owner.href : "/", // "#backup" is an in-page anchor
  };
  if (h.detail !== undefined) item.detail = h.detail;
  if (h.action !== undefined) item.action = h.action;
  if (h.since !== undefined) item.since = h.since;
  return item;
}

export function buildGlance(report: AttentionReport, vitals: KioskVitalsData | null): Glance {
  const { tone, text } = answerFor({ report, error: false, running: null, backupAgo: null });
  const count = (state: string) => report.probes.filter((p) => p.state === state).length;
  return {
    v: 1,
    checkedAt: report.checkedAt,
    tone,
    answer: text,
    lanes: report.hits.filter((h) => h.probe === "orchestra").map(toItem),
    items: report.hits.filter((h) => h.probe !== "orchestra").map(toItem),
    probes: { answered: count("answered"), failed: count("failed"), pending: count("pending") },
    vitals: vitals
      ? {
          cpu: vitals.cpu.percent,
          mem: vitals.memory.percent,
          diskMax: vitals.disk.length ? Math.max(...vitals.disk.map((d) => d.percent)) : null,
        }
      : null,
  };
}
