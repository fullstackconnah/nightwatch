"use client";

import { stripAnsi } from "@/lib/ansi-escapes";
import { LEVEL_CODE, type LogLevel, type LogLine } from "@/lib/log-types";

/**
 * Export one track's lines to a file.
 *
 * Two formats because they answer two different questions, and the split is
 * deliberate rather than a menu for its own sake:
 *
 *   TXT  — for reading and grepping. ANSI is stripped, because a .txt full of
 *          escape bytes is unusable in every viewer that is not a terminal, and
 *          the reader exporting a filtered error is going to grep it.
 *   JSON — lossless. `text` keeps its ANSI escapes verbatim, exactly as
 *          log-types.ts promises, so a JSON export can reconstruct the console's
 *          own rendering and a TXT export cannot.
 *
 * Both carry a header stating what was exported and under which filters. An
 * export that silently contains 412 of a container's 2000 lines, with no record
 * of why, is a file that will be misread later.
 */

export type ExportFormat = "json" | "txt";

export interface ExportContext {
  container: string;
  /** The regex source the reader had typed, or null. */
  query: string | null;
  /** Which levels were switched on when the export was taken. */
  levels: LogLevel[];
  /** True when the exported set includes lines pulled from the archive. */
  includesArchive: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `2026-07-31 18:12:03` in the reader's own timezone — the console shows local
 *  time in its gutter, and an export that disagrees with the screen is a trap. */
function localStamp(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** `20260731-1812` — sorts chronologically in a file listing. */
function fileStamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function describeFilters(ctx: ExportContext): string {
  const parts: string[] = [];
  parts.push(ctx.query ? `filter /${ctx.query}/i` : "no filter");
  parts.push(`levels ${ctx.levels.length > 0 ? ctx.levels.join(",") : "none"}`);
  parts.push(ctx.includesArchive ? "live buffer + archive" : "live buffer only");
  return parts.join(" · ");
}

export function toTxt(lines: LogLine[], ctx: ExportContext): string {
  const head = [
    `# nightwatch log export — ${ctx.container}`,
    `# taken ${localStamp(Date.now())}`,
    `# ${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${describeFilters(ctx)}`,
    `# columns: timestamp, level, channel, message (ANSI colour removed)`,
    "",
  ].join("\n");

  const body = lines
    .map(
      (l) =>
        `${localStamp(l.ts)}  ${LEVEL_CODE[l.level].padEnd(3)}  ${
          l.stream === "stderr" ? "err" : "out"
        }  ${stripAnsi(l.text)}`,
    )
    .join("\n");

  return `${head}${body}\n`;
}

export function toJson(lines: LogLine[], ctx: ExportContext): string {
  return `${JSON.stringify(
    {
      container: ctx.container,
      exportedAt: new Date().toISOString(),
      source: ctx.includesArchive ? "live+archive" : "live",
      filters: {
        regex: ctx.query,
        levels: ctx.levels,
      },
      count: lines.length,
      // `text` verbatim, ANSI escapes intact — this is the lossless format.
      lines: lines.map((l) => ({
        ts: l.ts,
        iso: new Date(l.ts).toISOString(),
        level: l.level,
        stream: l.stream,
        text: l.text,
      })),
    },
    null,
    2,
  )}\n`;
}

export function exportFilename(container: string, format: ExportFormat): string {
  // Container names are docker-safe already, but a name reaching the filesystem
  // deserves its own guard rather than trust inherited from another system.
  const safe = container.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `nightwatch-${safe}-${fileStamp(Date.now())}.${format}`;
}

/**
 * Trigger the download. The object URL is revoked on the next frame rather than
 * immediately: Safari has not started reading the blob by the time `click()`
 * returns, and revoking synchronously produces a zero-byte file.
 */
export function downloadLines(lines: LogLine[], ctx: ExportContext, format: ExportFormat): void {
  const content = format === "json" ? toJson(lines, ctx) : toTxt(lines, ctx);
  const mime = format === "json" ? "application/json" : "text/plain";
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportFilename(ctx.container, format);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
