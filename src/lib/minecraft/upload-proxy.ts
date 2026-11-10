import { holdAfterTimeout } from "../minecraft-busy.ts";
import { isTimeout } from "../integration-client.ts";

const TIMEOUT_COPY =
  "The Minecraft manager didn’t answer in time. The pack may still be installing, so check the list before you try again.";

/**
 * Runs the upstream upload call and maps its outcome to a status and JSON body. The guard is held, not
 * released, when OUR wait timed out: the manager answers only once the pack is installed, so it is still working.
 */
export async function guardedUpload(release: () => void, doFetch: () => Promise<Response>): Promise<{ status: number; body: unknown }> {
  let timedOut = false;
  try {
    let res: Response;
    try {
      res = await doFetch();
    } catch (e) {
      console.error("minecraft upload proxy failed", e);
      timedOut = isTimeout(e) || (e instanceof DOMException && e.name === "AbortError");
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
