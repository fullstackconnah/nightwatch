// Maps the lib's rejection messages to console copy; null keeps the route's generic text.
const COPY: Record<string, string> = {
  "rcon auth failed": "The Minecraft server rejected the RCON password.",
  "rcon unreachable": "The Minecraft server didn't reply over RCON.",
};

export function rconErrorCopy(message: string | undefined): string | null {
  return message !== undefined && Object.hasOwn(COPY, message) ? COPY[message] : null;
}
