/** Max kept partial line, in UTF-16 units; past this it is emitted as a line. */
export const MAX_PARTIAL = 64 * 1024;

/**
 * Split buffered log text into whole lines on CRLF, CR or LF. A trailing lone CR stays in
 * the remainder until the next chunk shows whether an LF follows. Pure so node:test can load it.
 */
export function splitLines(combined: string): { lines: string[]; rest: string } {
  const tail = combined.endsWith("\r") ? "\r" : "";
  const parts = (tail ? combined.slice(0, -1) : combined).split(/\r\n|\r|\n/);
  const rest = (parts.pop() ?? "") + tail;
  if (rest.length > MAX_PARTIAL) {
    parts.push(rest.replace(/\r$/, ""));
    return { lines: parts, rest: "" };
  }
  return { lines: parts, rest };
}
