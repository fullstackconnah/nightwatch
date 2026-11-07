const PACK_HOSTS = ["curseforge.com", "modrinth.com"];
const MC_VERSION_RE = /^[0-9][0-9A-Za-z.\-]{0,31}$/;

/** C3: the pack page URL becomes the manager's packRef, so only https pages on the two pack sites (or their subdomains) pass. */
export function packPageUrlOk(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && PACK_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Returns the first problem with a pack's url, name or version, or null when all three pass. mcVersion may be absent or null. */
export function packFieldsError(p: { name: string; pageUrl: string; mcVersion?: unknown }): string | null {
  if (!packPageUrlOk(p.pageUrl)) return "pack.pageUrl must be an https CurseForge or Modrinth page";
  if (p.name.length > 200) return "pack.name is too long (the most is 200 characters)";
  if (p.mcVersion != null && !(typeof p.mcVersion === "string" && MC_VERSION_RE.test(p.mcVersion))) return "pack.mcVersion is not a valid version";
  return null;
}
