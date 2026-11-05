import { isProbeOk, type ProbeFail } from "../integration-client.ts";
import { mediaWorker, type MediaWorkerClient } from "./worker.ts";

/* The three /api/media routes' logic, as plain Responses so node:test can run it (the route files only pass the request in).
 * Every body is a fixed sentence or the worker's own JSON: a worker error text, host or token never goes out, and an
 * upstream 401 is a 502 here (a 401 would send a good dashboard session to /login). */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Always 200: the page reads `worker` to pick its state. */
export async function libraryResponse(client: MediaWorkerClient = mediaWorker): Promise<Response> {
  const p = await client.library();
  return json(isProbeOk(p) ? { worker: "ok", data: p.data } : { worker: p.status });
}

function failure(p: ProbeFail, words: Record<number, string>): Response {
  const worker = p.status;
  if (p.httpStatus !== undefined && words[p.httpStatus]) return json({ error: words[p.httpStatus], worker }, p.httpStatus);
  if (p.status === "unconfigured") return json({ error: "The media worker isn’t connected.", worker }, 409);
  return json({ error: p.status === "unauthorized" ? "The media worker rejected the token." : "The media worker didn’t answer.", worker }, 502);
}

export async function titleResponse(id: string | null, client: MediaWorkerClient = mediaWorker): Promise<Response> {
  if (!id) return json({ error: "A title id is needed." }, 400);
  const p = await client.title(id);
  return isProbeOk(p) ? json(p.data) : failure(p, { 400: "That title id isn’t valid.", 404: "That title isn’t in the library." });
}

export async function scanResponse(client: MediaWorkerClient = mediaWorker): Promise<Response> {
  const p = await client.scan();
  return isProbeOk(p) ? json(p.data, 202) : failure(p, { 409: "A scan is already running." });
}

/* Jobs (PR B). The worker's reason text goes to the page only when it is a plain sentence: no path, host, address or JSON. */
const ID = /^[a-z0-9-]{8,40}$/;
export const validJobId = (id: string | null | undefined): id is string => !!id && ID.test(id);
const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;

export function safeReason(detail: string): string | null {
  const m = /HTTP \d+: (\{.*\})$/.exec(detail);
  if (!m) return null;
  let reason: unknown;
  try { reason = (JSON.parse(m[1]) as { error?: unknown }).error; } catch { return null; }
  if (typeof reason !== "string" || reason.length === 0 || reason.length > 200) return null;
  if (!/^[A-Za-z0-9 .,;'’()%\-]+$/.test(reason) || IPV4.test(reason)) return null;
  return reason;
}

const JOB_FALLBACK: Record<number, string> = {
  400: "That request isn’t valid.",
  404: "That job isn’t there.",
  409: "it can't be compressed right now",
  410: "The original has been deleted.",
  507: "The disk is too full to compress this.",
};

function jobFailure(p: ProbeFail): Response {
  const { httpStatus: s, detail } = p; // detail only ever leaves through safeReason
  if (s !== undefined && JOB_FALLBACK[s]) return json({ error: safeReason(detail) ?? JOB_FALLBACK[s], worker: p.status }, s);
  return failure(p, {});
}

/** Always 200 like the library: the page reads `worker`. */
export async function jobsResponse(client: MediaWorkerClient = mediaWorker): Promise<Response> {
  const p = await client.jobs();
  return json(isProbeOk(p) ? { worker: "ok", data: p.data } : { worker: p.status });
}

export async function enqueueResponse(body: unknown, client: MediaWorkerClient = mediaWorker): Promise<Response> {
  const b = body as { path?: unknown; paths?: unknown } | null;
  let target: string | string[];
  if (b && typeof b.path === "string" && b.path) target = b.path;
  else if (b && Array.isArray(b.paths) && b.paths.length > 0 && b.paths.length <= 200 && b.paths.every((x) => typeof x === "string" && x)) target = b.paths as string[];
  else return json({ error: "Send one path or up to 200 paths." }, 400);
  const p = await client.enqueue(target);
  return isProbeOk(p) ? json(p.data, 201) : jobFailure(p);
}

export async function cancelResponse(id: string | null, client: MediaWorkerClient = mediaWorker): Promise<Response> {
  if (!validJobId(id)) return json({ error: "That job id isn’t valid." }, 400);
  const p = await client.cancel(id);
  return isProbeOk(p) ? json(p.data) : jobFailure(p);
}

export async function cancelBatchResponse(id: string | null, client: MediaWorkerClient = mediaWorker): Promise<Response> {
  if (!validJobId(id)) return json({ error: "That batch id isn’t valid." }, 400);
  const p = await client.cancelBatch(id);
  return isProbeOk(p) ? json(p.data) : jobFailure(p);
}

export async function undoResponse(id: string | null, client: MediaWorkerClient = mediaWorker): Promise<Response> {
  if (!validJobId(id)) return json({ error: "That job id isn’t valid." }, 400);
  const p = await client.undo(id);
  return isProbeOk(p) ? json(p.data) : jobFailure(p);
}
