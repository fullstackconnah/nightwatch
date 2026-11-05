"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { MediaFile, TitleDetail as TitleDetailData } from "../../../services/media-worker/src/types";
import { FileAct } from "@/components/media/file-act";
import { WriteAction } from "@/components/strips/write-action";
import { Button } from "@/components/ui/button";
import { ApiError, fetcher, postJson } from "@/lib/client";
import { batchPlan, fileRow, seasonHead, titleSummary, type RowJobs } from "@/lib/media/page-model";

const GONE = "This title is gone since the last scan. Rescan to refresh the list.";
const DOWN = "Couldn’t load the files. The media worker didn’t answer.";

/** One file: one DOM, two grid layouts (columns at 1440, a stack at 390); the grids are the media block in globals.css. */
interface JobProps {
  rj: RowJobs | null;
  /** Writes are off while the page shows old data. */
  off: boolean;
  onChanged: () => void;
}

function FileRow({ file, kind, rj, off, onChanged }: { file: MediaFile; kind: "movie" | "show" } & JobProps) {
  const [dismissed, setDismissed] = useState(false);
  const r = fileRow(file, kind, rj, { dismissed });
  const estimated = r.cells.rate.startsWith("~");
  return (
    <li className="st-li md-file" data-feature="file-row" data-verdict={file.verdict.kind}>
      <span className="md-name" title={r.cells.name}>
        {r.cells.name}
      </span>
      <span className="md-size">{r.cells.size}</span>
      <span className="md-facts">
        <span className="md-res">{r.cells.res}</span>
        <span className="md-codec">{r.cells.codec}</span>
        <span className="md-rate">
          {estimated && <span className="sr-only">about </span>}
          {r.cells.rate}
        </span>
      </span>
      <span className="md-word" data-kind={r.tone === "active" || r.tone === "bad" ? r.tone : file.verdict.kind}>
        {r.word}
      </span>
      <span className="md-act">{r.act && <FileAct act={r.act} off={off} onChanged={onChanged} onDismiss={() => setDismissed(true)} />}</span>
      <p className="md-line">
        {r.line.facts && <span className="md-line-facts">{r.line.facts}</span>}
        {r.line.facts && r.line.text && " · "}
        {r.line.text}
      </p>
    </li>
  );
}

const COLS = ["File", "Size", "Res", "Codec", "Bitrate", "Verdict", ""];

/** The opened title's files. Fetched once per open (and per scan); the library poll never fetches a title. */
export function TitleDetail({ titleId, kind, scannedAt, rj, off, jobsSig, onChanged }: { titleId: string; kind: "movie" | "show"; scannedAt: string | null; jobsSig: string } & JobProps) {
  const { data, error, isLoading, mutate } = useSWR<TitleDetailData>(
    ["/api/media/title", titleId, scannedAt],
    ([url, id]: [string, string, string | null]) => fetcher(`${url}?id=${encodeURIComponent(id)}`),
    { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  );
  // A job moved on: the files carry the job they belong to, so read them again (the list stays put meanwhile).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else void mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsSig]);
  const job = { rj, off, onChanged };

  if (error) {
    return (
      <div className="st-stack">
        <p className="st-note">{error instanceof ApiError && error.status === 404 ? GONE : DOWN}</p>
        {!(error instanceof ApiError && error.status === 404) && (
          <div>
            <Button size="sm" variant="outline" onClick={() => void mutate()}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (!data || isLoading) {
    return (
      <div className="md-wait">
        <p className="st-note">Reading the files…</p>
      </div>
    );
  }

  // A season's name ascending, "Other" last.
  const seasons = [...(data.seasons ?? [])].sort((a, b) => (a.name === "Other" ? 1 : b.name === "Other" ? -1 : a.name.localeCompare(b.name, "en", { numeric: true })));
  const files = data.files ?? seasons.flatMap((s) => s.files);
  const plan = rj && rj.enabled && rj.ready ? batchPlan(files) : null;

  return (
    <div className="st-stack">
      <div className="st-row">
        <p className="st-note">
          {titleSummary(files)}
        </p>
        {plan && (
          <WriteAction
            label={plan.label}
            say={plan.say}
            yes={plan.yes}
            flight={plan.flight}
            failure="Couldn’t add the files"
            disabled={off}
            triggerClassName="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
            run={async () => {
              try {
                await postJson("/api/media/jobs", { paths: plan.paths });
              } catch (e) {
                const s = e instanceof ApiError ? e.message : "The media worker didn’t answer.";
                throw new Error(s.charAt(0).toLowerCase() + s.slice(1));
              }
              onChanged();
              await mutate();
            }}
          />
        )}
      </div>
      <div className="st-listhead md-cols" aria-hidden>
        {COLS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      {data.files && (
        <ul className="md-files" role="list">
          {data.files.map((f) => (
            <FileRow key={f.path} file={f} kind={kind} {...job} />
          ))}
        </ul>
      )}
      {seasons.map((s) => {
        const h = seasonHead(s);
        return (
          <section key={s.name}>
            <div className="st-listhead">
              <span>{h.name}</span>
              <span className="font-mono">{h.right}</span>
            </div>
            <ul className="md-files" role="list">
              {s.files.map((f) => (
                <FileRow key={f.path} file={f} kind={kind} {...job} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
