import { ApiError } from "./api-error.ts";

/** The red scrollback line for a failed send: the server's own sentence, or fixed copy when the request never got an answer (never the browser's "Failed to fetch"). */
export function consoleSendError(e: unknown): string {
  if (e instanceof ApiError) return e.message || "command failed";
  return "Couldn't reach the dashboard. The command may not have run.";
}

/** Why the Minecraft console is off, or null when it can take a command. First match wins: a stopped server explains more than a stale page. */
export function consoleHint(rcon: "ok" | "unavailable" | "rejected" | "unconfigured", running: boolean, stale: boolean, paused = false): string | null {
  if (rcon === "unconfigured") return "RCON not configured — add it in Settings → Integrations";
  if (!running) return "server is stopped — start it to use the console";
  if (paused && !stale) return "server is paused — resume it to use the console";
  if (rcon === "unavailable") return "booting — console unavailable";
  if (rcon === "rejected") return "RCON password rejected. Check it in Settings.";
  if (stale) return "paused while the page shows old data";
  return null;
}
