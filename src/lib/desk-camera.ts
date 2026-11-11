/* The desk widget's door-camera frame: pure decisions plus a small shared frame cache.
 * Relative imports only, so node:test can load it. Every non-200 body is EMPTY (the 503 is
 * glance's own body) and no upstream error text is ever read. */
import { bearerMatches } from "./bearer.ts";
import { deskAccess } from "./desk-auth.ts";

export const FRAME_CAP = 1.5 * 1024 * 1024;
const FRAME_TTL_MS = 5_000;
const FETCH_TIMEOUT_MS = 10_000;
const TYPES = new Set(["image/jpeg", "image/png"]);

export interface Frame {
  bytes: Uint8Array;
  type: string;
}
export type UpstreamFetch = (entity: string, signal: AbortSignal) => Promise<Response | { error: string; status: number }>;

/** Reads at most FRAME_CAP bytes while streaming; null for anything that is not a small jpeg or png. */
async function readFrame(res: Response): Promise<Frame | null> {
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const declared = Number(res.headers.get("content-length"));
  if (!TYPES.has(type) || !res.body || declared > FRAME_CAP) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > FRAME_CAP) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), type };
}

/**
 * One answer per camera for 5 s, failures included, with one shared in-flight fetch. The fetch has its
 * own timeout and never a caller's signal, so one client going away cannot fail the others.
 */
export function createFrameCache(upstream: UpstreamFetch, now: () => number = Date.now, timeoutMs: number = FETCH_TIMEOUT_MS) {
  const hits = new Map<string, { at: number; frame: Frame | null }>();
  const flights = new Map<string, Promise<Frame | null>>();
  const load = async (entity: string): Promise<Frame | null> => {
    try {
      const res = await upstream(entity, AbortSignal.timeout(timeoutMs));
      return res instanceof Response ? await readFrame(res) : null;
    } catch {
      return null;
    }
  };
  return {
    get(entity: string): Promise<Frame | null> {
      const hit = hits.get(entity);
      if (hit && now() - hit.at < FRAME_TTL_MS) return Promise.resolve(hit.frame);
      let flight = flights.get(entity);
      if (!flight) {
        flight = load(entity).then((frame) => {
          hits.set(entity, { at: now(), frame });
          return frame;
        }).finally(() => flights.delete(entity));
        flights.set(entity, flight);
      }
      return flight;
    },
  };
}

/** viewCamera ?? the first camera, from the doorbell resolver's own allowlist (indoor cameras are not in it). */
export function doorCameraEntity(s: { status: string; cameras: { entityId: string }[]; viewCamera: string | null }): string | null {
  if (s.status !== "ok") return null;
  return s.viewCamera ?? s.cameras[0]?.entityId ?? null;
}

export interface DeskCameraResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | string | null;
}
const NO_STORE = { "Cache-Control": "no-store" };
const empty = (status: number): DeskCameraResult => ({ status, headers: NO_STORE, body: null });
// Same body and headers as the glance route's "off", so flag-off cannot be told from desk-off.
const OFF: DeskCameraResult = {
  status: 503,
  headers: { ...NO_STORE, "Content-Type": "application/json" },
  body: JSON.stringify({ error: "Desk access is not turned on." }),
};

/** Order: desk off (503), bad bearer (401), flag off (503), no camera (404), then the cached frame (200 or 502). */
export async function deskCameraResponse(a: {
  deskToken: string | undefined;
  mcpToken: string | undefined;
  authorization: string | null;
  flag: () => boolean;
  resolve: () => Promise<string | null>;
  cache: { get(entity: string): Promise<Frame | null> };
}): Promise<DeskCameraResult> {
  try {
    if (deskAccess(a.deskToken, a.mcpToken) === "off") return OFF;
    if (!bearerMatches(a.authorization, a.deskToken)) return empty(401);
    if (!a.flag()) return OFF;
    const entity = await a.resolve();
    if (!entity) return empty(404);
    const frame = await a.cache.get(entity);
    if (!frame) return empty(502);
    return {
      status: 200,
      headers: { ...NO_STORE, "Content-Type": frame.type, "X-Content-Type-Options": "nosniff" },
      body: frame.bytes,
    };
  } catch {
    return empty(502);
  }
}
