const PACK_HOSTS = ["curseforge.com", "modrinth.com"];
export const MC_VERSION_RE = /^[0-9][0-9A-Za-z.\-]{0,31}$/;

/** C3: the pack page URL becomes the manager's packRef, so only https pages on the two pack sites (or their subdomains) pass. */
export function packPageUrlOk(u: string): boolean {
  // new URL() drops tab/LF/CR silently, and the raw value lands in instance.env
  if (/[\x00-\x1f\x7f]/.test(u)) return false;
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

const LOADER_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+\-]{0,63}$/;

/** First problem with an upload's mcVersion or loaderVersion (both go into instance.env), or null. loaderVersion may be absent. */
export function uploadFieldsError(mcVersion: string, loaderVersion: string | undefined): string | null {
  if (!MC_VERSION_RE.test(mcVersion)) return "mcVersion must look like a Minecraft version, such as 1.21.1.";
  if (loaderVersion && !LOADER_VERSION_RE.test(loaderVersion)) return "loaderVersion must be a version, such as 21.1.77.";
  return null;
}
