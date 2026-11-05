"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { LibraryResponse } from "../../../../services/media-worker/src/types";
import { CancelAll, QueueBody } from "@/components/media/file-act";
import { TitleDetail } from "@/components/media/title-detail";
import { PageHead } from "@/components/strips/page-head";
import { StripList, type StripSpec } from "@/components/strips/strip-list";
import { WriteAction } from "@/components/strips/write-action";
import { SegmentButton } from "@/components/ui/segment-button";
import { ApiError, fetcher, postJson } from "@/lib/client";
import { mediaModel, rowJobs, type Filter, type JobsBody, type LibraryBody, type Order } from "@/lib/media/page-model";
import { useNow } from "@/lib/use-now";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "show", label: "Shows" },
  { id: "save", label: "Could save space" },
];

/** The route's fixed sentences, lower-cased to follow "Couldn’t start a rescan:". */
const rescanReason = (e: unknown) => {
  const s = e instanceof ApiError ? e.message : "The media worker didn’t answer.";
  return s.charAt(0).toLowerCase() + s.slice(1);
};

export default function MediaPage() {
  const [pollMs, setPollMs] = useState(30_000);
  const lib = useSWR<LibraryBody>("/api/media/library", fetcher, { refreshInterval: pollMs });
  // Jobs: every 5 s while one runs, else every minute; only read when the library answer is live.
  const [jobsMs, setJobsMs] = useState(60_000);
  const jobsRes = useSWR<JobsBody>("/api/media/jobs", fetcher, { refreshInterval: jobsMs });
  const jobs = jobsRes.data?.worker === "ok" && !jobsRes.error ? jobsRes.data.data : null;
  useEffect(() => setJobsMs(jobs?.current || jobs?.queue.length ? 5_000 : 60_000), [jobs?.current, jobs?.queue.length]);
  const now = useNow(true);
  const [filter, setFilter] = useState<Filter>("all");

  // The last good answer, so a down worker or a failing fetch still shows what was true (smarthome/page.tsx does the same).
  const [last, setLast] = useState<{ data: LibraryResponse; at: number } | null>(null);
  useEffect(() => {
    if (!lib.isValidating && !lib.error && lib.data?.worker === "ok") setLast({ data: lib.data.data, at: Date.now() });
  }, [lib.isValidating, lib.error, lib.data]);

  const order = useRef<Order | null>(null);
  const model = mediaModel({ body: lib.error ? undefined : lib.data, loadError: Boolean(lib.error), last, filter, prevOrder: order.current, now, jobs });
  const off = model.stale || model.chip.label === "Worker down";
  const rj = rowJobs(jobs);
  const jobsSig = jobs ? [jobs.current, ...jobs.queue, ...jobs.recent].map((j) => (j ? `${j.id}:${j.state}` : "")).join(",") : "";
  const changed = () => void Promise.all([jobsRes.mutate(), lib.mutate()]);
  useEffect(() => {
    order.current = model.order;
    setPollMs(model.pollMs);
  }, [model.order, model.pollMs]);

  const data = lib.data?.worker === "ok" && !lib.error ? lib.data.data : last?.data;
  const kindOf = Object.fromEntries((data?.titles ?? []).map((t) => [t.id, t.kind] as const));
  const strips: StripSpec[] = model.strips.map((s) => {
    if (s.id === "queue" && model.queue) {
      const slot = model.cancelAll && <CancelAll say={model.cancelAll.say} ids={model.cancelAll.ids} off={off} onChanged={changed} />;
      return { ...s, slot, body: <QueueBody queue={model.queue} off={off} onChanged={changed} /> };
    }
    const titleId = model.idOf[s.id];
    return {
      ...s,
      body: <TitleDetail titleId={titleId} kind={kindOf[titleId] ?? "movie"} scannedAt={data?.scannedAt ?? null} rj={rj} off={off} jobsSig={jobsSig} onChanged={changed} />,
    };
  });

  const rescan = model.action.shown && (
    <>
      <WriteAction
        label="Rescan"
        confirm={false}
        flight="Starting a rescan…"
        failure="Couldn’t start a rescan"
        disabled={!model.action.enabled}
        describedBy="md-rescan-why"
        run={async () => {
          try {
            await postJson("/api/media/scan");
          } catch (e) {
            throw new Error(rescanReason(e));
          }
          await lib.mutate();
        }}
      />
      {model.action.reason && (
        <span id="md-rescan-why" className="sr-only">
          {model.action.reason}
        </span>
      )}
    </>
  );

  return (
    <div className="st-page md-page pb-2">
      <PageHead title="Media" chip={model.chip} answer={model.answer} evidence={model.evidence} link={model.link} action={rescan || undefined} notice={model.notice} />
      {model.showFilter && (
        <div className="st-row md-filter">
          <div role="group" aria-label="Show" className="md-seg">
            {FILTERS.map((f) => (
              <SegmentButton key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)} label={`${f.label}: ${model.filterCounts[f.id]}`}>
                {f.label}
              </SegmentButton>
            ))}
          </div>
          {model.disk && <p className="st-note">{model.disk}</p>}
        </div>
      )}
      {model.filterEmpty && (
        <div className="panel md-empty">
          <p className="st-note">{model.filterEmpty}</p>
          <SegmentButton active={false} onClick={() => setFilter("all")}>
            Show all
          </SegmentButton>
        </div>
      )}
      {strips.length > 0 && <StripList strips={strips} autoTarget={model.autoTarget} />}
    </div>
  );
}
