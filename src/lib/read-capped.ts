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

/** JSON.parse of a capped body; throws (like res.json() on bad JSON) when the body is over `max` or not JSON. */
export async function readJsonCapped<T>(res: { headers: Headers; body: ReadableStream<Uint8Array> | null }, max: number): Promise<T> {
  const text = await readCapped(res, max);
  if (text === null) throw new Error("upstream body over cap");
  return JSON.parse(text) as T;
}
