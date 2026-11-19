import { holdAfterTimeout } from "../minecraft-busy.ts";
import { isTimeout } from "../integration-client.ts";

const TIMEOUT_COPY =
  "The Minecraft manager didn’t answer in time. The pack may still be installing, so check the Installed list before you try again.";

const NOT_SENT_COPY =
  "The upload didn’t finish within 10 minutes, so the pack was not installed. Try again on a faster connection.";

/** Pipes a request body through and reports whether it was read to the end (flush runs only then). */
export function trackBodySent(src: ReadableStream<Uint8Array>): { body: ReadableStream<Uint8Array>; sent: () => boolean } {
  let sent = false;
  const body = src.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: () => void (sent = true) }));
  return { body, sent: () => sent };
}

/**
 * Runs the upstream upload call and maps its outcome to a status and JSON body. The guard is held, not
 * released, when OUR wait timed out after the whole body went upstream: the manager answers only once the pack is
 * installed, so it is still working. A timeout while the body was still streaming means nothing was installed.
 */
export async function guardedUpload(release: () => void, doFetch: () => Promise<Response>, bodySent: () => boolean = () => true): Promise<{ status: number; body: unknown }> {
  let timedOut = false;
  try {
    let res: Response;
    try {
      res = await doFetch();
    } catch (e) {
      console.error("minecraft upload proxy failed", e);
      timedOut = isTimeout(e);
      if (timedOut && !bodySent()) {
        timedOut = false;
        return { status: 504, body: { error: NOT_SENT_COPY } };
      }
      return timedOut
        ? { status: 504, body: { error: TIMEOUT_COPY } }
        : { status: 502, body: { error: "Could not reach the Minecraft manager." } };
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof body?.detail === "string" ? body.detail.slice(0, 200) : `mc-manager returned HTTP ${res.status}`;
      // The manager's own 401/403 is our server-to-server auth failing, not the browser's.
      return { status: res.status === 401 || res.status === 403 ? 502 : res.status, body: { error: detail } };
    }
    return { status: res.status, body };
  } finally {
    if (timedOut) holdAfterTimeout(release);
    else release();
  }
}
