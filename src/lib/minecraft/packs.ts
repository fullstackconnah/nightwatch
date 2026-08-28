// Relative import, not "@/lib/config": packs.test.ts imports this module
// directly and `node --test` has no tsconfig-paths resolver registered
// (unlike Next's build, which does), so an "@/" import would resolve fine
// under tsc but throw ERR_MODULE_NOT_FOUND at test time.
import { loadConfig } from "../config.ts";

/**
 * Modpack search over CurseForge + Modrinth for the /minecraft "install a
 * pack" flow. Both APIs are queried concurrently and degrade independently —
 * a CurseForge outage (or a missing key) still leaves Modrinth results
 * usable, and vice versa. Normalizers are pure and defensive over `unknown`
 * so a shape change on either API's side fails soft (empty array) rather
 * than throwing through the search route.
 */

const SEARCH_TIMEOUT_MS = 6000;
const PAGE_SIZE = 20;

export interface PackResult {
  source: "curseforge" | "modrinth";
  id: string;
  slug: string;
  name: string;
  summary: string;
  icon: string | null;
  downloads: number;
  mcVersion: string | null; // newest supported MC version — sent to the manager for java tag mapping
  loader: string | null; // "forge" | "fabric" | "neoforge" | "quilt" | null
  pageUrl: string; // becomes the manager's packRef
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// --- CurseForge --------------------------------------------------------------

// CurseForge's modLoader enum (only the values modpacks actually use).
const CF_LOADER_BY_ID: Record<number, string> = {
  1: "forge",
  4: "fabric",
  5: "quilt",
  6: "neoforge",
};

export function normalizeCurseforge(json: unknown): PackResult[] {
  if (!isRecord(json) || !Array.isArray(json.data)) return [];

  const out: PackResult[] = [];
  for (const entry of json.data) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const slug = typeof entry.slug === "string" ? entry.slug : "";

    const logo = isRecord(entry.logo) ? entry.logo : null;
    const icon = typeof logo?.url === "string" ? logo.url : null;

    const links = isRecord(entry.links) ? entry.links : null;
    const websiteUrl = typeof links?.websiteUrl === "string" ? links.websiteUrl : null;
    const pageUrl = websiteUrl || `https://www.curseforge.com/minecraft/modpacks/${slug}`;

    let mcVersion: string | null = null;
    let loader: string | null = null;
    const indexes = Array.isArray(entry.latestFilesIndexes) ? entry.latestFilesIndexes : [];
    const first = indexes.find(isRecord);
    if (first) {
      mcVersion = typeof first.gameVersion === "string" ? first.gameVersion : null;
      loader = typeof first.modLoader === "number" ? CF_LOADER_BY_ID[first.modLoader] ?? null : null;
    }

    out.push({
      source: "curseforge",
      id: typeof id === "number" || typeof id === "string" ? String(id) : "",
      slug,
      name: typeof entry.name === "string" ? entry.name : slug,
      summary: typeof entry.summary === "string" ? entry.summary : "",
      icon,
      downloads: typeof entry.downloadCount === "number" ? entry.downloadCount : 0,
      mcVersion,
      loader,
      pageUrl,
    });
  }
  return out;
}

// --- Modrinth ------------------------------------------------------------

const MODRINTH_LOADERS = ["forge", "fabric", "neoforge", "quilt"];

export function normalizeModrinth(json: unknown): PackResult[] {
  if (!isRecord(json) || !Array.isArray(json.hits)) return [];

  const out: PackResult[] = [];
  for (const entry of json.hits) {
    if (!isRecord(entry)) continue;
    const projectId = typeof entry.project_id === "string" ? entry.project_id : "";
    const slug = typeof entry.slug === "string" ? entry.slug : "";
    if (!projectId || !slug) continue;

    const icon = typeof entry.icon_url === "string" ? entry.icon_url : null;

    const categories = Array.isArray(entry.categories) ? entry.categories : [];
    const loader = MODRINTH_LOADERS.find((l) => categories.includes(l)) ?? null;

    const versions = Array.isArray(entry.versions) ? entry.versions : [];
    const lastVersion = versions.length > 0 ? versions[versions.length - 1] : null;
    const mcVersion = typeof lastVersion === "string" ? lastVersion : null;

    out.push({
      source: "modrinth",
      id: projectId,
      slug,
      name: typeof entry.title === "string" ? entry.title : slug,
      summary: typeof entry.description === "string" ? entry.description : "",
      icon,
      downloads: typeof entry.downloads === "number" ? entry.downloads : 0,
      mcVersion,
      loader,
      pageUrl: `https://modrinth.com/modpack/${slug}`,
    });
  }
  return out;
}

// --- fetch + merge ------------------------------------------------------------

function enc(s: string): string {
  return encodeURIComponent(s);
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error("unreachable");
  }
  if (!res.ok) throw new Error(`http ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error("non-json response");
  }
}

async function searchCurseforge(q: string, key: string | undefined): Promise<{ status: "ok" | "no-key" | "error"; results: PackResult[] }> {
  if (!key) return { status: "no-key", results: [] };
  try {
    const url =
      `https://api.curseforge.com/v1/mods/search?gameId=432&classId=4471` +
      `&searchFilter=${enc(q)}&sortField=2&sortOrder=desc&pageSize=${PAGE_SIZE}`;
    const json = await fetchJson(url, { "x-api-key": key });
    return { status: "ok", results: normalizeCurseforge(json) };
  } catch {
    return { status: "error", results: [] };
  }
}

async function searchModrinth(q: string): Promise<{ status: "ok" | "error"; results: PackResult[] }> {
  try {
    const facets = enc('[["project_type:modpack"]]');
    const url = `https://api.modrinth.com/v2/search?query=${enc(q)}&facets=${facets}&limit=${PAGE_SIZE}`;
    const json = await fetchJson(url);
    return { status: "ok", results: normalizeModrinth(json) };
  } catch {
    return { status: "error", results: [] };
  }
}

/** Interleaves two lists CF-first: cf[0], mr[0], cf[1], mr[1], ... then any
 *  leftover tail from the longer list. */
function interleave(cf: PackResult[], mr: PackResult[]): PackResult[] {
  const out: PackResult[] = [];
  const max = Math.max(cf.length, mr.length);
  for (let i = 0; i < max; i++) {
    if (i < cf.length) out.push(cf[i]);
    if (i < mr.length) out.push(mr[i]);
  }
  return out;
}

export async function searchPacks(
  q: string,
  source: "all" | "curseforge" | "modrinth",
): Promise<{
  results: PackResult[];
  curseforge: "ok" | "no-key" | "error";
  modrinth: "ok" | "error";
}> {
  const key = loadConfig().minecraft?.curseforgeKey?.trim() || undefined;

  const [cf, mr] = await Promise.all([searchCurseforge(q, key), searchModrinth(q)]);

  const merged = interleave(cf.results, mr.results);
  const results =
    source === "curseforge" ? merged.filter((p) => p.source === "curseforge") :
    source === "modrinth" ? merged.filter((p) => p.source === "modrinth") :
    merged;

  return {
    results,
    curseforge: cf.status,
    modrinth: mr.status,
  };
}
