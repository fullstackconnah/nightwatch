import type { HermesJob } from "./types/hermes.ts";

const JOB_KINDS = new Set(["digest", "alert-test", "ask", "summarize"]);

type RawObj = Record<string, unknown>;

function obj(v: unknown): RawObj {
  return v && typeof v === "object" ? (v as RawObj) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function mapJobResult(raw: unknown): HermesJob["result"] {
  if (!raw || typeof raw !== "object") return null;
  const r = obj(raw);
  const title = str(r.title);
  const body = str(r.body);
  if (title === null && body === null) return null;
  return { title: title ?? "", body: body ?? "" };
}

export function mapJobBody(raw: unknown): HermesJob {
  const r = obj(raw);
  const kind = typeof r.kind === "string" && JOB_KINDS.has(r.kind) ? (r.kind as HermesJob["kind"]) : "digest";
  // A newer daemon state (e.g. "queued") is in progress; callers have their own deadlines.
  // A missing or non-string state is a daemon fault.
  const known = r.state === "done" || r.state === "error" ? r.state : null;
  const state: HermesJob["state"] = known ?? (str(r.state) ? "running" : "error");
  return {
    state,
    kind,
    startedAt: str(r.startedAt),
    finishedAt: str(r.finishedAt),
    result: mapJobResult(r.result),
    error: str(r.error) ?? (str(r.state) ? null : "Hermes sent no job state."),
  };
}
