/** Page text for a failed process-list read: names an errno code (ENOENT, EACCES) but never the message or a path. */
export function processListErrorText(err: unknown): string {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^E[A-Z]+$/.test(code) ? `Could not read the process list (${code}).` : "Could not read the process list.";
}
