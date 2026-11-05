/* /media's whole story in one pure function: the head (chip, answer, evidence, notice, the Rescan state), the title
 * strips (filtered, in a frozen order) and how often to ask again. Words follow section 5 of the media shape brief.
 * It reads only the worker's contract (type-only import) and never shows an address, a path or a raw error. */
import { ageText } from "../home.ts";
import type { LibraryResponse, MediaFile, TitleSummary } from "../../../services/media-worker/src/types.ts";

export type Tone = "ok" | "neutral" | "warn" | "bad";
export type Filter = "all" | "movie" | "show" | "save";
/** What GET /api/media/library answers: the worker's status, and its data when ok. */
export type LibraryBody = { worker: "ok"; data: LibraryResponse } | { worker: "unconfigured" | "unauthorized" | "unreachable" };
export interface Order {
  scannedAt: string | null;
  ids: string[];
}
export interface ModelInput {
  /** The latest answer; undefined before the first one or while the dashboard's own fetch fails. */
  body: LibraryBody | undefined;
  /** The dashboard's own fetch is failing right now (SWR keeps the last good data in `last`). */
  loadError: boolean;
  last: { data: LibraryResponse; at: number } | null;
  filter: Filter;
  prevOrder: Order | null;
  now: number;
}
export interface MediaStrip {
  id: string;
  title: string;
  state: string;
  tone: null;
}
export interface Model {
  chip: { tone: Tone; label: string };
  answer: string;
  evidence: string;
  notice: string | null;
  link: { href: string; label: string } | null;
  action: { shown: boolean; enabled: boolean; reason: string | null };
  autoTarget: null | "keep";
  strips: MediaStrip[];
  /** strip id back to the title id (the strip id is a hash-safe token, the title id can hold anything). */
  idOf: Record<string, string>;
  order: Order;
  pollMs: number;
  stale: boolean;
  disk: string | null;
  showFilter: boolean;
  filterCounts: Record<Filter, number>;
  filterEmpty: string | null;
}

const GIB = 1024 ** 3;
const SOON = 30_000;
const CALM = 300_000;
const PAUSED = "Controls are paused while the page shows old data.";
const SETTINGS = { href: "/settings#media", label: "Open Settings" };

const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
const ago = (ms: number) => `${ageText(Math.max(0, ms))} ago`;

/** Binary GiB shown as "GB" (the files' own sizes); TB once the rounded GB figure reaches 1,000. */
export function mediaBytes(bytes: number): string {
  const gb = bytes / GIB;
  return Number(gb.toFixed(1)) >= 1000 ? `${(gb / 1024).toFixed(2)} TB` : `${gb.toFixed(1)} GB`;
}
const mbit = (kbps: number) => `${(kbps / 1000).toFixed(1)} Mbit/s`;

/** A strip id: a readable slug plus a hash of the whole title id, so it is unique, hash-safe and fits a URL fragment. */
export function stripId(titleId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < titleId.length; i++) h = Math.imul(h ^ titleId.charCodeAt(i), 0x01000193) >>> 0;
  const slug = titleId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 40).replace(/-+$/, "");
  return `${slug}-${h.toString(36)}`;
}

const saving = (t: Pick<TitleSummary, "compressible" | "estSavingBytes">) => (t.compressible > 0 ? `could save ~${mediaBytes(t.estSavingBytes)}` : "nothing to compress");

function stripState(t: TitleSummary): string {
  const parts = [t.kind === "movie" ? "Movie" : "Show", mediaBytes(t.bytes)];
  if (t.kind === "show" || t.files > 1) parts.push(plural(t.files, "file"));
  parts.push(saving(t));
  return parts.join(" · ");
}

function arrange(titles: TitleSummary[], data: LibraryResponse, firstScan: boolean, prev: Order | null): TitleSummary[] {
  const bySize = [...titles].sort((a, b) => b.bytes - a.bytes);
  // The order only moves when a scan finishes (or while the first one is still filling the page), so a poll never shuffles rows.
  if (firstScan || !prev || prev.scannedAt !== data.scannedAt) return bySize;
  const rank = new Map(prev.ids.map((id, i) => [id, i]));
  return bySize.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

const FILTER_WORDS: Record<Exclude<Filter, "all">, string> = { movie: "No movies.", show: "No shows.", save: "No titles could save space." };

export function mediaModel(i: ModelInput): Model {
  const { body, now } = i;
  const base: Model = {
    chip: { tone: "neutral", label: "Checking" },
    answer: "",
    evidence: "",
    notice: null,
    link: null,
    action: { shown: true, enabled: false, reason: null },
    autoTarget: null,
    strips: [],
    idOf: {},
    order: { scannedAt: null, ids: [] },
    pollMs: SOON,
    stale: false,
    disk: null,
    showFilter: false,
    filterCounts: { all: 0, movie: 0, show: 0, save: 0 },
    filterEmpty: null,
  };
  const head = (o: Partial<Model>): Model => ({ ...base, ...o });

  if (!body && !i.loadError && !i.last) {
    return head({ answer: "Connecting to the media worker…", evidence: "First answer usually takes a second", autoTarget: "keep" });
  }
  if (body?.worker === "unconfigured") {
    return head({
      chip: { tone: "neutral", label: "Not connected" },
      answer: "The media worker isn’t connected yet.",
      evidence: "Add the media worker’s address and token in Settings → Integrations.",
      link: SETTINGS,
      action: { shown: false, enabled: false, reason: null },
    });
  }
  if (body?.worker === "unauthorized") {
    return head({
      chip: { tone: "warn", label: "Token rejected" },
      answer: "The media worker rejected the token. Check it in Settings → Integrations.",
      evidence: "Nothing to show until the token works.",
      link: SETTINGS,
      action: { shown: false, enabled: false, reason: null },
    });
  }

  // Which data the page shows: the live answer, else the last good one when the worker or the dashboard's fetch is down.
  const live = body?.worker === "ok" ? body.data : null;
  const old = live ? null : i.last;
  const data = live ?? old?.data ?? null;
  const asOf = old?.at ?? now;

  const stripsFor = (d: LibraryResponse, firstScan: boolean) => {
    const ordered = arrange(d.titles, d, firstScan, i.prevOrder);
    const filterCounts: Record<Filter, number> = {
      all: d.titles.length,
      movie: d.titles.filter((t) => t.kind === "movie").length,
      show: d.titles.filter((t) => t.kind === "show").length,
      save: d.titles.filter((t) => t.compressible > 0).length,
    };
    const shown = ordered.filter((t) => (i.filter === "all" ? true : i.filter === "save" ? t.compressible > 0 : t.kind === i.filter));
    const strips = shown.map((t): MediaStrip => ({ id: stripId(t.id), title: t.name, state: stripState(t), tone: null }));
    return {
      strips,
      idOf: Object.fromEntries(ordered.map((t) => [stripId(t.id), t.id])),
      order: { scannedAt: d.scannedAt, ids: ordered.map((t) => t.id) },
      filterCounts,
      showFilter: d.titles.length > 0,
      filterEmpty: strips.length === 0 && d.titles.length > 0 && i.filter !== "all" ? FILTER_WORDS[i.filter] : null,
      disk: `Disk: ${mediaBytes(d.disk.freeBytes)} free of ${mediaBytes(d.disk.sizeBytes)}${d.disk.heldBytes > 0 ? ` · ${mediaBytes(d.disk.heldBytes)} of originals held` : ""}`,
    };
  };

  if (!data) {
    // The worker is down (or the dashboard's own fetch failed) before any good answer.
    return head({
      chip: { tone: "warn", label: "Worker down" },
      answer: "The media worker isn’t answering. Checking again every 30 s.",
      evidence: "Nothing to show until it answers.",
      action: { shown: true, enabled: false, reason: "The worker isn’t answering." },
    });
  }

  const scannedAgo = data.scannedAt ? ago(now - Date.parse(data.scannedAt)) : ago(now - asOf);
  const scanned = `Scanned ${scannedAgo} · ${plural(data.totals.files, "file")}`;
  const firstScan = data.scan.state === "running" && data.scannedAt === null;
  const shape = { ...stripsFor(data, firstScan), pollMs: data.scan.state === "running" ? SOON : CALM };

  if (old) {
    // Old data: the dashboard can't reach the worker, or can't reach its own server.
    const dashboardDown = i.loadError && !body;
    return head({
      ...shape,
      chip: dashboardDown ? { tone: "neutral", label: "Stale" } : { tone: "warn", label: "Worker down" },
      answer: dashboardDown
        ? `Showing what was true ${ago(now - old.at)}. The dashboard isn’t getting answers.`
        : `The media worker isn’t answering. Showing the scan from ${scannedAgo}.`,
      evidence: scanned,
      notice: PAUSED,
      action: { shown: true, enabled: false, reason: dashboardDown ? "The dashboard isn’t getting answers." : "The worker isn’t answering." },
      autoTarget: "keep",
      pollMs: SOON,
      stale: dashboardDown,
    });
  }

  const { totals, scan } = data;
  const use = `Movies and shows use ${mediaBytes(totals.bytes)}`;
  const normalAnswer =
    totals.compressible > 0
      ? `${use}. ${plural(totals.compressible, "file")} could save about ${mediaBytes(totals.estSavingBytes)}.`
      : `${use} in ${plural(totals.titles, "title")}. Nothing needs compressing.`;

  if (firstScan) {
    return head({
      ...shape,
      chip: { tone: "neutral", label: "Scanning" },
      answer: scan.filesTotal
        ? `Scanning the library for the first time: ${num(scan.filesDone)} of ${num(scan.filesTotal)} files.`
        : `Scanning the library for the first time: ${plural(scan.filesDone, "file")} read so far.`,
      evidence: "Titles appear as they’re read.",
      action: { shown: true, enabled: false, reason: "A scan is running." },
    });
  }
  if (scan.state === "running") {
    return head({
      ...shape,
      chip: { tone: "ok", label: "Rescanning" },
      answer: normalAnswer,
      evidence: `Rescanning: ${scan.filesTotal ? `${num(scan.filesDone)} of ${num(scan.filesTotal)} files` : plural(scan.filesDone, "file")}`,
      action: { shown: true, enabled: false, reason: "A scan is running." },
    });
  }
  const on = { shown: true, enabled: true, reason: null };
  if (scan.state === "failed") {
    return head({
      ...shape,
      chip: { tone: "warn", label: "Scan failed" },
      answer: data.scannedAt ? `The last scan failed. Showing the scan from ${scannedAgo}.` : "The first scan failed. Rescan to try again.",
      evidence: "The worker’s log has the details.",
      action: on,
    });
  }
  if (!data.scannedAt) {
    return head({ ...shape, answer: "The library hasn’t been scanned yet.", evidence: "Rescan to read it.", action: on });
  }
  if (data.titles.length === 0) {
    return head({ ...shape, chip: { tone: "neutral", label: "Empty" }, answer: "No movies or shows found in the media folders.", evidence: scanned, action: on });
  }
  return head({ ...shape, chip: { tone: "ok", label: "Up to date" }, answer: normalAnswer, evidence: scanned, action: on });
}

// ---- file rows (the title detail) ----

export interface FileRow {
  cells: { name: string; size: string; res: string; codec: string; rate: string };
  word: "Compress" | "OK" | "Skipped" | "Can’t compress";
  line: { facts: string; text: string };
  /** The per-file action, added with compression (PR A3). */
  act: null;
}

const WORD = { compress: "Compress", ok: "OK", skip: "Skipped", cant: "Can’t compress" } as const;

export function fileRow(f: MediaFile, kind: "movie" | "show"): FileRow {
  const v = f.video;
  const rate = !v || v.kbps === null ? "—" : `${v.kbpsSource === "estimated" ? "~" : ""}${mbit(v.kbps)}`;
  const facts = v ? [`${v.width}×${v.height}`, ...(v.hdr ? [v.hdr] : []), ...(v.tenBit ? ["10-bit"] : []), ...(v.interlaced ? ["Interlaced"] : [])].join(" · ") : "";
  // The sweet spot is the file's rate divided by its ratio (the dashboard can't import the worker's own table).
  const ratio = f.verdict.kind === "compress" || f.verdict.kind === "ok" ? f.verdict.ratio : null;
  const sweet = v && v.kbps !== null && ratio ? `sweet spot for ${v.res} ${kind === "movie" ? "film" : "TV"}: ${mbit(v.kbps / ratio)}` : null;
  let text: string;
  if (f.verdict.kind === "compress") {
    const pct = Math.round((f.verdict.estSavingBytes / f.bytes) * 100);
    text = [`saves ~${mediaBytes(f.verdict.estSavingBytes)} (${pct}%) at ~${mbit(f.verdict.targetKbps)}`, sweet && `${sweet} (${f.verdict.ratio.toFixed(1)}×)`].filter(Boolean).join(" · ");
  } else {
    text = [f.verdict.reason, f.verdict.kind === "ok" ? sweet : null].filter(Boolean).join(" · ");
  }
  return {
    cells: { name: f.name, size: mediaBytes(f.bytes), res: v?.res ?? "—", codec: v?.codec ?? "—", rate },
    word: WORD[f.verdict.kind],
    line: { facts, text },
    act: null,
  };
}

export function seasonHead(s: { name: string; bytes: number; files: MediaFile[] }): { name: string; right: string } {
  const save = s.files.reduce((n, f) => n + (f.verdict.kind === "compress" ? f.verdict.estSavingBytes : 0), 0);
  return { name: s.name, right: `${mediaBytes(s.bytes)} · ${plural(s.files.length, "file")} · ${save > 0 ? `could save ~${mediaBytes(save)}` : "nothing to compress"}` };
}
