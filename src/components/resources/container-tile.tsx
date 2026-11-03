/** State dot class shared by the container lists, the rail, the kiosk admin panel and Home. */
export function stateDotClass(c: { state: string; health: string | null }): string {
  if (c.health === "unhealthy") return "dot-unhealthy";
  if (c.state === "running") return "dot-running";
  if (c.state === "restarting") return "dot-restarting";
  if (c.state === "paused") return "dot-paused";
  if (c.state === "dead") return "dot-dead";
  return "dot-stopped";
}
