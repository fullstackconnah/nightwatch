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
      await reader.cancel();
      break;
    }
  }
  return out.slice(0, max);
}
