// What the Minecraft log box says when there are no log lines to show. Relative imports only (node:test).
export type LogWhy = "loading" | "no-container" | "docker-failed" | "paused";

/** null = show the logs; otherwise the sentence for the box (bad = red). First match wins. */
export function logStripText(logs: string | undefined, error: boolean, why: LogWhy): { text: string; bad: boolean } | null {
  if (logs) return null;
  if (error) return { text: "Couldn't read logs.", bad: true };
  if (logs === "") return { text: "no output", bad: false };
  if (why === "docker-failed") return { text: "Couldn't reach Docker.", bad: true };
  if (why === "no-container") return { text: "No Minecraft container.", bad: false };
  if (why === "paused") return { text: "Paused before any logs loaded.", bad: false };
  return { text: "Reading logs…", bad: false };
}

/** The log text to show: lines fetched for another container are dropped; a failed Docker list (id gone, why not "no-container") keeps them. */
export function shownLogs(data: { logs: string; id: string } | undefined, id: string | undefined, why: LogWhy): string | undefined {
  if (!data) return undefined;
  if (id !== undefined) return data.id === id ? data.logs : undefined;
  return why === "no-container" ? undefined : data.logs;
}
