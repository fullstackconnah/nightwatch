/* THESIS: /images lists every tag flat today — thirty-plus rows for maybe a dozen
   real applications, most of which are yesterday's version left behind by an
   update. Grouping by repository makes "what apps do I have images for" the
   default read; multi-tag noise (usually old-versions-of-one-app) tucks behind
   a disclosure, and a repo with exactly one tag never earns a pointless expander.
   OWN-WORLD: nightwatch console — mono repo/tag strings, the Badge component for
   the registry chip, no invented colour. Pure data shaping only; the interactive
   row rendering lives in the page itself, same as networks/page.tsx's local
   BridgeRow/UplinkBand — this page's groups are not reused anywhere else. */

import { Badge } from "@/components/ui/badge";

export interface ImageRow {
  id: string;
  tags: string[];
  size: number;
  created: number;
  inUse: boolean;
  usedBy: string[];
}

export interface ImageTagEntry {
  imageId: string;
  /** Full "repo:tag", or "<12-char id> (untagged)" for a dangling image. */
  ref: string;
  /** The tag alone ("latest", "7"), or null for an untagged entry. */
  tag: string | null;
  size: number;
  created: number;
  inUse: boolean;
  usedBy: string[];
}

export interface ImageGroup {
  /** The repository path, or the literal sentinel below for dangling images. */
  repo: string;
  registry: string | null;
  tags: ImageTagEntry[];
  /** Sum of each *distinct* image ID's size in this group — a repo whose two
   *  tags happen to point at the same image (a fresh retag) must not be
   *  double-counted just because it has two ref strings. */
  totalSize: number;
  latestCreated: number;
}

export const UNTAGGED = "<untagged>";

/**
 * Splits a RepoTag ("lscr.io/linuxserver/sonarr:latest", "redis:7",
 * "192.168.1.70:5000/foo:latest") into repo + tag on the LAST colon that
 * appears after the last slash — the only split that survives a registry port
 * without mistaking it for the tag separator.
 */
function splitRepoTag(ref: string): { repo: string; tag: string } {
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon > lastSlash) {
    return { repo: ref.slice(0, lastColon), tag: ref.slice(lastColon + 1) };
  }
  return { repo: ref, tag: "latest" };
}

/**
 * A repo's first path segment is a registry host only if it looks like one —
 * contains a "." or ":", or is literally "localhost" — per Docker's own
 * reference-parsing rule. "linuxserver/sonarr" is a Docker Hub namespace, not
 * a registry, and gets no chip; "lscr.io/linuxserver/sonarr" does.
 */
export function parseRegistry(repo: string): string | null {
  const slash = repo.indexOf("/");
  if (slash === -1) return null;
  const first = repo.slice(0, slash);
  if (first === "localhost" || first.includes(".") || first.includes(":")) return first;
  return null;
}

/** Groups images by repository, sorted newest-tag-first — the same default feel
 *  the flat list had, just applied to the group rather than every row. */
export function buildImageGroups(images: ImageRow[]): ImageGroup[] {
  const groups = new Map<string, ImageGroup>();

  const addEntry = (repo: string, registry: string | null, entry: ImageTagEntry) => {
    const g = groups.get(repo) ?? { repo, registry, tags: [], totalSize: 0, latestCreated: 0 };
    g.tags.push(entry);
    g.latestCreated = Math.max(g.latestCreated, entry.created);
    groups.set(repo, g);
  };

  for (const img of images) {
    if (img.tags.length === 0) {
      addEntry(UNTAGGED, null, {
        imageId: img.id,
        ref: `${img.id.replace("sha256:", "").slice(0, 12)} (untagged)`,
        tag: null,
        size: img.size,
        created: img.created,
        inUse: img.inUse,
        usedBy: img.usedBy,
      });
      continue;
    }
    for (const t of img.tags) {
      const { repo, tag } = splitRepoTag(t);
      addEntry(repo, parseRegistry(repo), {
        imageId: img.id,
        ref: t,
        tag,
        size: img.size,
        created: img.created,
        inUse: img.inUse,
        usedBy: img.usedBy,
      });
    }
  }

  for (const g of groups.values()) {
    g.tags.sort((a, b) => b.created - a.created);
    const uniqueSizes = new Map<string, number>();
    for (const t of g.tags) uniqueSizes.set(t.imageId, t.size);
    g.totalSize = [...uniqueSizes.values()].reduce((a, b) => a + b, 0);
  }

  return [...groups.values()].sort((a, b) => b.latestCreated - a.latestCreated);
}

export function RegistryChip({ registry }: { registry: string }) {
  return (
    <Badge variant="neutral" title={`hosted at ${registry}`} className="shrink-0">
      {registry}
    </Badge>
  );
}
