/* /media's whole story in one pure function: the head (chip, answer, evidence, notice, the Rescan state), the title
 * strips (filtered, in a frozen order) and how often to ask again. Words follow section 5 of the media shape brief.
 * It reads only the worker's contract (type-only import) and never shows an address, a path or a raw error. */
import { ageText } from "../home.ts";
import type { Job, JobsResponse, LibraryResponse, MediaFile, TitleSummary } from "../../../services/media-worker/src/types.ts";

export type Tone = "ok" | "neutral" | "warn" | "bad";
export type Filter = "all" | "movie" | "show" | "save";
/** What GET /api/media/library answers: the worker's status, and its data when ok. */
export type LibraryBody = { worker: "ok"; data: LibraryResponse } | { worker: "unconfigured" | "unauthorized" | "unreachable" };
export interface Order {
  scannedAt: string | null;
  ids: string[];
}
/** What GET /api/media/jobs answers: the worker's status, and its data when ok. */
export type JobsBody = { worker: "ok"; data: JobsResponse } | { worker: "unconfigured" | "unauthorized" | "unreachable" };
export interface ModelInput {
  /** The latest jobs answer (null or absent while unknown or down); only used with live library data. */
  jobs?: JobsResponse | null;
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
  autoTarget: null | "keep" | "queue";
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
  /** The Compress queue strip's detail (null when the strip is not shown). */
  queue: QueueView | null;
  /** "Cancel all" in the queue strip's head, when 2 or more jobs are queued or running. */
  cancelAll: { say: string; ids: string[] } | null;
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

function libraryModel(i: ModelInput): Model {
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
    queue: null,
    cancelAll: null,
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
      disk: `Disk: ${mediaBytes(d.disk.freeBytes)} free of ${mediaBytes(d.disk.sizeBytes)}${d.disk.heldBytes > 0 ? ` · ${mediaBytes(d.disk.heldBytes)} held for Undo` : ""}`,
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
  /** The per-file write, when there is one. */
  act: RowAct | null;
  /** Lets the row style its word: a running or failed job, or Compress dimmed until calibration. */
  tone: "active" | "bad" | "dim" | null;
}

export type RowAct =
  | { kind: "compress"; path: string; name: string; say: string }
  | { kind: "cancel"; id: string; name: string; confirm: boolean }
  | { kind: "undo"; id: string; name: string }
  | { kind: "retry"; path: string; name: string; say: string };

/** What a file row needs of the jobs answer. */
export interface RowJobs {
  enabled: boolean;
  ready: boolean;
  reason?: string;
  byId: Map<string, Job>;
  /** Jobs ahead of this queued one (the running job counts). */
  ahead: (id: string) => number;
}
export function rowJobs(j: JobsResponse | null | undefined): RowJobs | null {
  if (!j) return null;
  const all = [...(j.current ? [j.current] : []), ...j.queue, ...j.recent];
  const order = [...(j.current ? [j.current] : []), ...j.queue].map((x) => x.id);
  return { enabled: j.compressEnabled, ready: j.compressReady, reason: j.reason, byId: new Map(all.map((x) => [x.id, x])), ahead: (id) => Math.max(0, order.indexOf(id)) };
}

const WORD = { compress: "Compress", ok: "OK", skip: "Skipped", cant: "Can’t compress" } as const;

function verdictRow(f: MediaFile, kind: "movie" | "show"): FileRow {
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
    tone: null,
  };
}

export function seasonHead(s: { name: string; bytes: number; files: MediaFile[] }): { name: string; right: string } {
  const save = s.files.reduce((n, f) => n + (f.verdict.kind === "compress" ? f.verdict.estSavingBytes : 0), 0);
  return { name: s.name, right: `${mediaBytes(s.bytes)} · ${plural(s.files.length, "file")} · ${save > 0 ? `could save ~${mediaBytes(save)}` : "nothing to compress"}` };
}

// ---- jobs (PR B): the row states of section 5b, the queue strip and the batch button ----

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const SYDNEY = "Australia/Sydney";
/** "12 Nov", in Sydney time like the worker's own sentences. */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: SYDNEY });
}
/** "45 s", "12 min", "1 h 20 min". */
export function etaText(sec: number): string {
  if (sec < 90) return `${Math.max(1, Math.round(sec))} s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

const FAILED: Record<NonNullable<Job["failedCheck"]>, (v?: number) => string> = {
  probe: () => "the new file couldn’t be read",
  duration: (v) => `the new file is ${v ?? 0} s shorter`,
  streams: () => "an audio or subtitle track went missing",
  decode: () => "the new file has decode errors",
  frames: () => "the frame count changed",
  saving: (v) => `it saved only ${v ?? 0}%`,
  "small-saving": (v) => `it saved only ${mediaBytes(v ?? 0)}, too little to keep`,
  "source-changed": () => "the source file changed during compression",
  disk: () => "the disk got too full",
  restart: () => "the worker restarted twice",
  encoder: () => "the encoder stopped with an error",
  swap: () => "the swap was interrupted",
};
export const failedWords = (j: Pick<Job, "failedCheck" | "failedValue">) => (j.failedCheck ? FAILED[j.failedCheck](j.failedValue) : "something went wrong");

type JobLite = Pick<Job, "id" | "state"> & Partial<Job>;
const savedOf = (j: JobLite) => (j.outputBytes !== undefined && j.sourceBytes !== undefined ? mediaBytes(Math.max(0, j.sourceBytes - j.outputBytes)) : null);
const JELLY = " Jellyfin will pick up the change at its next library scan.";

/** One job as a word, a line and a tone; the file row and the queue strip both print it. */
export function jobText(j: JobLite, ahead = 0): { word: string; line: string; tone: FileRow["tone"] } {
  const saved = savedOf(j);
  const until = j.heldUntil ? dayLabel(j.heldUntil) : null;
  switch (j.state) {
    case "queued":
      return { word: "Queued", line: ahead > 0 ? `${ahead} ahead` : "next", tone: null };
    case "encoding": {
      const p = j.progress;
      const parts = [`${Math.round(p?.pct ?? 0)}%`, ...(p?.fps ? [`${Math.round(p.fps)} fps`] : []), ...(p?.etaSec != null ? [`about ${etaText(p.etaSec)} left`] : [])];
      return { word: "Compressing", line: parts.join(" · "), tone: "active" };
    }
    case "verifying":
      return { word: "Checking", line: "Checking the new file…", tone: "active" };
    case "swapping":
      return { word: "Swapping", line: "Swapping in the new file…", tone: "active" };
    case "done":
      return {
        word: "Compressed",
        line: `${saved ? `Saved ${saved}. ` : ""}${until ? `Original kept until ${until}.` : "Original kept for 7 days."}${j.jellyfin === "off" || j.jellyfin === "failed" ? JELLY : ""}`,
        tone: null,
      };
    case "undone":
      return { word: "Restored", line: "Original restored.", tone: null };
    case "failed":
      return { word: "Failed", line: `Kept the original: ${failedWords(j)}.`, tone: "bad" };
    case "cancelled":
      return { word: "Cancelled", line: "Cancelled. The original is unchanged.", tone: null };
    case "purged":
      return { word: "Compressed", line: `${saved ? `Saved ${saved}. ` : ""}Original deleted${until ? ` ${until}` : ""}.`, tone: null };
  }
}

/** The question for one Compress (shape brief section 5c). */
export function compressSay(f: MediaFile): string {
  if (f.verdict.kind !== "compress") return "";
  const est = f.bytes - f.verdict.estSavingBytes;
  const pct = Math.round((f.verdict.estSavingBytes / f.bytes) * 100);
  return `Compresses ${f.name} from ${mediaBytes(f.bytes)} to about ${mediaBytes(est)} (about ${pct}% smaller) at about ${mbit(f.verdict.targetKbps)}. The original is kept for 7 days after it’s done; Undo puts it back.`;
}

/** A file row: the job's state first, then the verdict. Without `rj` (jobs unknown) it is the plain verdict row. */
export function fileRow(f: MediaFile, kind: "movie" | "show", rj?: RowJobs | null, opts: { dismissed?: boolean } = {}): FileRow {
  const row = verdictRow(f, kind);
  if (!rj) return row;
  const name = f.name;
  const known: JobLite | null = f.job ? (rj.byId.get(f.job.id) ?? { id: f.job.id, state: f.job.state }) : null;
  const job = known && !(opts.dismissed && known.state === "failed") ? known : null;
  if (job) {
    const t = jobText(job, rj.ahead(job.id));
    const base: FileRow = { ...row, word: t.word as FileRow["word"], line: { facts: "", text: t.line }, tone: t.tone };
    switch (job.state) {
      case "queued":
        return { ...base, act: { kind: "cancel", id: job.id, name, confirm: false } };
      case "encoding":
      case "verifying":
        return { ...base, act: { kind: "cancel", id: job.id, name, confirm: true } };
      case "done":
        return { ...base, act: { kind: "undo", id: job.id, name } };
      case "failed":
        return { ...base, act: { kind: "retry", path: f.path, name, say: compressSay(f) } };
      default:
        return base;
    }
  }
  if (f.verdict.kind !== "compress") return row;
  if (!rj.enabled) return { ...row, tone: "dim", line: { ...row.line, text: `${row.line.text} · Compress turns on after calibration` } };
  if (!rj.ready) return { ...row, line: { facts: "", text: `Compress is unavailable: ${rj.reason ?? "the worker isn’t ready"}` } };
  return { ...row, act: { kind: "compress", path: f.path, name, say: compressSay(f) } };
}

const NOT_AGAIN = new Set(["queued", "encoding", "verifying", "swapping", "done", "purged"]);
/** Files Compress may still offer: the verdict says compress and no job is active, held or purged (S9). */
export const suggestedFiles = (files: MediaFile[]) => files.filter((f) => f.verdict.kind === "compress" && !(f.job && NOT_AGAIN.has(f.job.state)));
/** The summary row of a title: "1 file · could save ~x" (one file), "3 files · 2 could save ~x". */
export function titleSummary(files: MediaFile[]): string {
  const sv = suggestedFiles(files);
  const save = sv.reduce((n, f) => n + (f.verdict.kind === "compress" ? f.verdict.estSavingBytes : 0), 0);
  return `${plural(files.length, "file")} · ${sv.length === 0 ? "nothing to compress" : `${files.length === 1 ? "" : `${sv.length} `}could save ~${mediaBytes(save)}`}`;
}
const savingOf = (f: MediaFile) => (f.verdict.kind === "compress" ? f.verdict.estSavingBytes : 0);
/** The suggested files of a title that the batch button would queue: the largest savings first, at most 200. */
export function batchPlan(files: MediaFile[]): { label: string; say: string; yes: string; flight: string; paths: string[] } | null {
  const all = suggestedFiles(files);
  if (all.length === 0) return null;
  const pick = [...all].sort((a, b) => savingOf(b) - savingOf(a)).slice(0, 200);
  const k = pick.length;
  const size = pick.reduce((n, f) => n + f.bytes, 0);
  const save = pick.reduce((n, f) => n + savingOf(f), 0);
  return {
    label: all.length > 200 ? "Compress the 200 largest" : `Compress ${k} suggested`,
    say: `Compresses ${plural(k, "file")} from ${mediaBytes(size)} to about ${mediaBytes(size - save)} (saves about ${mediaBytes(save)}). They run one at a time; each original is kept for 7 days after it’s done, and Undo puts it back.`,
    yes: `Yes, compress ${k}`,
    flight: `Adding ${k} files…`,
    paths: pick.map((f) => f.path),
  };
}

export interface QueueLine {
  id: string;
  name: string;
  word: string;
  line: string;
  tone: FileRow["tone"];
  pct: number | null;
  /** Cancel for a queued (no question) or running (question) job. */
  cancel: "ask" | "now" | null;
}
export interface QueueView {
  current: QueueLine | null;
  queued: QueueLine[];
  recent: QueueLine[];
}

function queueLine(j: Job, ahead: number): QueueLine {
  const t = jobText(j, ahead);
  const running = j.state === "encoding" || j.state === "verifying";
  return {
    id: j.id,
    name: fileName(j.path),
    word: t.word,
    line: t.line,
    tone: t.tone,
    pct: j.state === "encoding" ? Math.max(0, Math.min(100, j.progress?.pct ?? 0)) : null,
    cancel: j.state === "queued" ? "now" : running ? "ask" : null,
  };
}

const QUEUE_ID = "queue";
/** The jobs answer layered over the library model: the queue strip, the Compressing chip, the queued count. */
function withJobs(m: Model, i: ModelInput): Model {
  const j = i.jobs;
  if (!j || i.body?.worker !== "ok" || m.stale) return m;
  const waiting = j.queue.length;
  const busy = j.current !== null || waiting > 0;
  const rj = rowJobs(j) as RowJobs;
  const queue: QueueView = {
    current: j.current ? queueLine(j.current, 0) : null,
    queued: j.queue.map((q) => queueLine(q, rj.ahead(q.id))),
    recent: j.recent.map((r) => queueLine(r, 0)),
  };
  const lastSaved = j.recent.find((r) => r.state === "done" && savedOf(r));
  const state = j.current
    ? `Compressing ${fileName(j.current.path)} · ${Math.round(j.current.progress?.pct ?? 0)}%`
    : waiting > 0
      ? `${waiting} queued`
      : !j.compressEnabled
        ? "Off until calibration"
        : `Nothing queued${lastSaved ? ` · last saved ${savedOf(lastSaved)}` : ""}`;
  const show = busy || j.recent.length > 0 || !j.compressEnabled;
  const strip: MediaStrip = { id: QUEUE_ID, title: "Compress queue", state, tone: null };
  const strips = !show ? m.strips : busy ? [strip, ...m.strips] : [...m.strips, strip];
  const active = (j.current ? 1 : 0) + waiting;
  const cancelAll =
    active >= 2
      ? {
          ids: [...j.queue.map((q) => q.id), ...(j.current ? [j.current.id] : [])],
          say: j.current
            ? `Stops compressing ${fileName(j.current.path)} and removes ${plural(waiting, "queued file")}. Every original stays as it is.`
            : `Removes ${plural(waiting, "queued file")}. Every original stays as it is.`,
        }
      : null;
  const out: Model = { ...m, strips, queue: show ? queue : null, cancelAll, evidence: waiting > 0 ? `${m.evidence} · ${waiting} queued` : m.evidence };
  if (j.current) {
    out.chip = { tone: "ok", label: "Compressing" };
    out.answer = `Compressing ${fileName(j.current.path)}: ${Math.round(j.current.progress?.pct ?? 0)}%.${waiting > 0 ? ` ${waiting} more queued.` : ""}`;
    out.autoTarget = QUEUE_ID;
  } else if (waiting > 0 && j.compressEnabled && !j.compressReady) {
    out.chip = { tone: "warn", label: "Compress unavailable" };
  }
  return out;
}

export function mediaModel(i: ModelInput): Model {
  return withJobs(libraryModel(i), i);
}
