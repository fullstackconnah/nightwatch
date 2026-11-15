"use client";

/* The kiosk calendar: the data hook (shared by the glance pane and the Standard section) and the pane. kiosk-agenda.ts
   decides every word; the Standard section lives beside BriefingCard in kiosk-display.tsx. The server serves today and
   tomorrow; this re-evaluates each minute so an event leaves when it ends, with no fetch. No role, button or handler on
   the pane: a press promotes glance to Standard like any other pane. */

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/client";
import { SIZE } from "@/components/kiosk/kiosk-forecast";
import { StaleTag } from "@/components/kiosk/kiosk-stale-tag";
import { useFreshness } from "@/lib/kiosk-client";
import { agendaView, type AgendaView } from "@/lib/kiosk-agenda";
import type { CalendarResponse } from "@/lib/calendar-feed";
import { useNow } from "@/lib/use-now";

const CALENDAR_REFRESH_MS = 5 * 60_000;

export interface KioskAgenda {
  /** Null while loading, unconfigured, failed, or when nothing is left today or tomorrow. */
  view: AgendaView | null;
  /** Last list shown, but the latest fetch failed or the server's own refresh did. */
  stale: boolean;
  /** Never read, or the last list no longer covers tomorrow. */
  failed: boolean;
}

export function useKioskAgenda(): KioskAgenda {
  const swr = useSWR<CalendarResponse>("/kiosk/api/calendar", fetcher, { refreshInterval: CALENDAR_REFRESH_MS, keepPreviousData: true });
  const fr = useFreshness(swr);
  const now = useNow(true, true); // 0 is "not yet known" (hydration)
  const data = fr.data;
  const view = useMemo(() => (data?.status === "ok" && now ? agendaView(data.events, now) : null), [data, now]);
  if (fr.status === "loading") return { view: null, stale: false, failed: false };
  if (!data) return { view: null, stale: false, failed: true };
  if (data.status === "error") return { view: null, stale: false, failed: true };
  return { view, stale: fr.status === "ready-stale" || (data.status === "ok" && data.stale), failed: false };
}

export function KioskAgendaPane({ pane, stale }: { pane: AgendaView["pane"]; stale: boolean }) {
  const lead = `${pane.figure}${pane.period ? ` ${pane.period}` : ""}`;
  const ink = pane.dim ? "text-ink-dim" : "text-ink";
  return (
    <div data-agenda-pane="" className="flex w-full max-w-xl flex-col gap-1 text-left">
      <span className="sr-only">
        {[pane.caption, lead, pane.title, pane.till, pane.more].filter(Boolean).join(", ")}
        {stale ? ". Not updated recently." : ""}
      </span>
      {/* h-6 holds the row so the sunroom stale pill (24 px) shifts nothing. */}
      <div aria-hidden className="flex h-6 items-center gap-2">
        <span className="microlabel">{pane.caption}</span>
        {stale && <StaleTag />}
      </div>
      <div aria-hidden className="flex min-h-8 items-baseline gap-2">
        <span data-agenda-figure="" className={`shrink-0 font-mono leading-none tabular-nums text-ink ${SIZE.glance.temp}`}>{pane.figure}</span>
        {pane.period && <span className="shrink-0 text-xl text-ink-dim">{pane.period}</span>}
        <span className={`min-w-0 truncate text-xl ${ink}`}>{pane.title}</span>
        {pane.till && <span className="shrink-0 text-xl text-ink-dim">{pane.till}</span>}
      </div>
      {pane.more && (
        <div aria-hidden className="truncate text-xl text-ink-dim">
          {pane.more}
        </div>
      )}
    </div>
  );
}
