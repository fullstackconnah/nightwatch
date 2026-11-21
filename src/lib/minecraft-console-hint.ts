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
