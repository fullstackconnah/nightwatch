/** Cap for widget and integration JSON: unpaged sonarr/radarr lists run about 3-8 KB per title, so 1500+ titles pass 8 MB. */
export const UPSTREAM_JSON_MAX = 32 * 1024 * 1024;

/** Reads a response body as text, at most `max` bytes (the reader is cancelled there). A content-length over `max` returns null without reading. */
export async function readCapped(res: { headers: Headers; body: ReadableStream<Uint8Array> | null }, max: number): Promise<string | null> {
  const len = Number(res.headers.get("content-length"));
  if (len > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.byteLength;
    out += dec.decode(value, { stream: true });
    if (got >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out.slice(0, max);
}

/** The message readJsonCapped throws for a body over the cap (declared or streamed), so a caller can tell it from a timeout or bad JSON. */
export const BODY_OVER_CAP = "upstream body over cap";

/** JSON.parse of a capped body; throws BODY_OVER_CAP when the body is over `max`, and (like res.json()) a SyntaxError when it is not JSON. */
export async function readJsonCapped<T>(res: { headers: Headers; body: ReadableStream<Uint8Array> | null }, max: number): Promise<T> {
  // readCapped is given max + 1 to see an overrun, which would let a declared size of exactly max + 1 through
  if (Number(res.headers.get("content-length")) > max) {
    await res.body?.cancel().catch(() => {});
    throw new Error(BODY_OVER_CAP);
  }
  const text = await readCapped(res, max + 1);
  // shortcut: counts characters, so a multibyte body just over the cap still fails as bad JSON; count bytes if a caller ever needs that case named
  if (text === null || text.length > max) throw new Error(BODY_OVER_CAP);
  return JSON.parse(text) as T;
}
