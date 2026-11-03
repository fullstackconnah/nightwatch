"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Answer, StatusSlot } from "@/components/home/answer";
import { AttentionList } from "@/components/home/attention-list";
import { ChangesList } from "@/components/home/changes-list";
import { Launcher, isSortKey, type SortKey } from "@/components/home/launcher";
import { SidePanel } from "@/components/home/side-panel";
import { useAttentionReport, useBackupStatus, useContainers, useWidgets } from "@/lib/client";
import { LAST_LOOKED_KEY, answerFor, clock, parseLastLooked, probeLine } from "@/lib/home";

/** Age for the answer line: "40 min", "9 h", "3 d". */
function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

/** When the last fetch succeeded. SWR keeps the same `data` object when a poll returns the same JSON, so watch `isValidating`. */
function useFetchedAt(r: { data?: unknown; error?: unknown; isValidating: boolean }): number | null {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (!r.isValidating && r.data && !r.error) setAt(Date.now());
  }, [r.isValidating, r.data, r.error]);
  return at;
}

export default function HomePage() {
  const containers = useContainers(5000);
  const { data, error, mutate } = containers;
  const { data: widgetData } = useWidgets(20000);
  const { data: backup } = useBackupStatus();

  // R6: "last looked" is per device. Seeded null for the server pass, resolved in an effect (the kiosk pattern),
  // and written on leave, so this visit's `since` never moves.
  const [looked, setLooked] = useState<ReturnType<typeof parseLastLooked> | null>(null);
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(LAST_LOOKED_KEY);
    } catch {
      // Storage blocked: fall through to the last 24 h.
    }
    setLooked(parseLastLooked(raw, Date.now()));
    const save = () => {
      try {
        window.localStorage.setItem(LAST_LOOKED_KEY, String(Date.now()));
      } catch {
        // Device-local only; nothing to recover.
      }
    };
    const onVisibility = () => document.visibilityState === "hidden" && save();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const report = useAttentionReport(looked?.since ?? null);
  const reportAt = useFetchedAt(report);
  const containersAt = useFetchedAt(containers);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("group");
  const filterRef = useRef<HTMLInputElement | null>(null);

  // Mount-only: adopt ?sort= if valid (cpu and mem links from before fall back to groups).
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("sort");
    if (isSortKey(requested)) setSort(requested);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("sort", sort);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [sort]);

  // `/` focuses the filter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      filterRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(() => (data?.containers ?? []).filter((c) => !c.tile.hidden), [data]);
  const hiddenNames = useMemo(
    () => new Set((data?.containers ?? []).filter((c) => c.tile.hidden).map((c) => c.name)),
    [data],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((c) => c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q));
  }, [visible, query]);

  const nightly = backup?.status === "ok" ? backup.items.find((i) => i.kind === "backup") : undefined;
  const answer = answerFor({
    report: report.data ?? null,
    error: !!report.error,
    running: data?.counts.running ?? null,
    backupAgo: nightly?.state === "OK" && nightly.at ? ago(Date.now() - Date.parse(nightly.at)) : null,
  });
  const line = probeLine(report.data ?? null, report.data ? clock(report.data.checkedAt) : "");
  const reconnect = useCallback(() => void Promise.all([report.mutate(), mutate()]), [report, mutate]);

  return (
    <section className="hm">
      <header className="hm-head">
        <Answer tone={answer.tone} text={answer.text} />
        <StatusSlot
          line={line}
          reportAt={reportAt}
          containersAt={containersAt}
          reportError={!!report.error}
          onReconnect={reconnect}
          onRetry={() => void report.mutate()}
        />
      </header>
      <AttentionList report={report.data ?? null} error={!!report.error} />
      <div className="hm-grid">
        <ChangesList
          changes={report.data?.changes ?? null}
          hiddenNames={hiddenNames}
          sinceMs={looked?.since ?? null}
          fallbackLabel={looked?.label != null}
        />
        <SidePanel />
      </div>
      <Launcher
        data={data}
        error={!!error && !data}
        filtered={filtered}
        widgets={widgetData?.widgets}
        query={query}
        setQuery={setQuery}
        sort={sort}
        setSort={setSort}
        filterRef={filterRef}
      />
    </section>
  );
}
