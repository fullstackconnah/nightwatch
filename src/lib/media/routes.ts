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
