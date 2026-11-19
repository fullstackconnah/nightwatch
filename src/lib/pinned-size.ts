/** What a pinned row's size cell shows. A scan that carries an error and no entries (missing or unreadable folder)
 *  is cached like a good scan with usedBytes 0, so it must read as failed, not as "0 B". */
export function pinnedSizeState(a: {
  isLoading: boolean;
  hasError: boolean;
  scan: { error: string | null; entries: unknown[] } | undefined;
}): "loading" | "error" | "size" | "none" {
  if (a.isLoading && !a.scan) return "loading";
  if (a.hasError && !a.scan) return "error";
  if (a.scan) return a.scan.error && a.scan.entries.length === 0 ? "error" : "size";
  return "none";
}
