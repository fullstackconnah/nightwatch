"use client";

import useSWR from "swr";
import type { MediaFile, TitleDetail as TitleDetailData } from "../../../services/media-worker/src/types";
import { Button } from "@/components/ui/button";
import { ApiError, fetcher } from "@/lib/client";
import { fileRow, mediaBytes, seasonHead } from "@/lib/media/page-model";

const GONE = "This title is gone since the last scan. Rescan to refresh the list.";
const DOWN = "Couldn’t load the files. The media worker didn’t answer.";

/** One file: one DOM, two grid layouts (columns at 1440, a stack at 390); the grids are the media block in globals.css. */
function FileRow({ file, kind }: { file: MediaFile; kind: "movie" | "show" }) {
  const r = fileRow(file, kind);
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
      <span className="md-word" data-kind={file.verdict.kind}>
        {r.word}
      </span>
      <p className="md-line">
        {r.line.facts && <span className="md-line-facts">{r.line.facts}</span>}
        {r.line.facts && r.line.text && " · "}
        {r.line.text}
      </p>
    </li>
  );
}

const COLS = ["File", "Size", "Res", "Codec", "Bitrate", "Verdict"];

/** The opened title's files. Fetched once per open (and per scan); the library poll never fetches a title. */
export function TitleDetail({ titleId, kind, scannedAt }: { titleId: string; kind: "movie" | "show"; scannedAt: string | null }) {
  const { data, error, isLoading, mutate } = useSWR<TitleDetailData>(
    ["/api/media/title", titleId, scannedAt],
    ([url, id]: [string, string, string | null]) => fetcher(`${url}?id=${encodeURIComponent(id)}`),
    { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  );

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
  const savers = files.filter((f) => f.verdict.kind === "compress");
  const save = savers.reduce((n, f) => n + (f.verdict.kind === "compress" ? f.verdict.estSavingBytes : 0), 0);

  return (
    <div className="st-stack">
      <div className="st-row">
        <p className="st-note">
          {files.length} {files.length === 1 ? "file" : "files"} · {savers.length > 0 ? `${savers.length} could save ~${mediaBytes(save)}` : "nothing to compress"}
        </p>
      </div>
      <div className="st-listhead md-cols" aria-hidden>
        {COLS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      {data.files && (
        <ul className="md-files" role="list">
          {data.files.map((f) => (
            <FileRow key={f.path} file={f} kind={kind} />
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
                <FileRow key={f.path} file={f} kind={kind} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
