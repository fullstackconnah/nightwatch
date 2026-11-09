/** Pre-read guard for an upload: a missing Content-Length is 411, a bad or oversized one 413, so a body is never buffered first. */
export function contentLengthError(header: string | null, max: number, noun = "Audio"): { status: 411 | 413; detail: string } | null {
  if (!header) return { status: 411, detail: "Content-Length is required." };
  const n = Number(header);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    return { status: 413, detail: `${noun} exceeds the ${max / (1024 * 1024)}MB limit.` };
  }
  return null;
}
