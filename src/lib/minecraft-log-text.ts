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
