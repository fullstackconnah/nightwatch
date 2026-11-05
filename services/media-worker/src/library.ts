import { statfsSync } from "node:fs";
import type { LibraryResponse, MediaFile, ScanState, TitleDetail, TitleSummary } from "./types.ts";

interface Group { id: string; kind: "movie" | "show"; name: string; files: MediaFile[] }

const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
const byBytes = (a: MediaFile, b: MediaFile) => b.bytes - a.bytes;

/** movies/<dir>/** is one title; a loose file in movies/ or tv/ is its own title with the file's path as id. */
function group(files: Record<string, MediaFile>): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const f of Object.values(files)) {
    const seg = f.path.split("/");
    const loose = seg.length === 2;
    const id = loose ? f.path : `${seg[0]}/${seg[1]}`;
    let g = groups.get(id);
    if (!g) {
      g = { id, kind: seg[0] === "movies" ? "movie" : "show", name: loose ? stripExt(seg[1]) : seg[1], files: [] };
      groups.set(id, g);
    }
    g.files.push(f);
  }
  return groups;
}

const compressible = (files: MediaFile[]) => files.filter((f) => f.verdict.kind === "compress");
const saving = (files: MediaFile[]) =>
  compressible(files).reduce((sum, f) => sum + (f.verdict.kind === "compress" ? f.verdict.estSavingBytes : 0), 0);
const sum = (files: MediaFile[]) => files.reduce((n, f) => n + f.bytes, 0);

function summary(g: Group): TitleSummary {
  return {
    id: g.id, kind: g.kind, name: g.name, bytes: sum(g.files), files: g.files.length,
    compressible: compressible(g.files).length, estSavingBytes: saving(g.files),
  };
}

export function readDisk(mediaRoot: string, statfs: typeof statfsSync = statfsSync): LibraryResponse["disk"] {
  try {
    const s = statfs(mediaRoot);
    return { sizeBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize, heldBytes: 0 };
  } catch {
    return { sizeBytes: 0, freeBytes: 0, heldBytes: 0 };
  }
}

export function buildLibrary(
  files: Record<string, MediaFile>, scan: ScanState, scannedAt: string | null, disk: LibraryResponse["disk"],
): LibraryResponse {
  const titles = [...group(files).values()].map(summary).sort((a, b) => b.bytes - a.bytes);
  const all = Object.values(files);
  return {
    scan, scannedAt,
    totals: {
      bytes: sum(all), files: all.length, titles: titles.length,
      compressible: compressible(all).length, estSavingBytes: saving(all),
    },
    disk, titles,
  };
}

export function titleDetail(files: Record<string, MediaFile>, id: string): TitleDetail | null {
  const g = group(files).get(id);
  if (!g) return null;
  const { files: _count, ...base } = summary(g);
  if (g.kind === "movie") return { ...base, files: [...g.files].sort(byBytes) };
  const seasons = new Map<string, MediaFile[]>();
  for (const f of g.files) {
    const seg = f.path.split("/");
    const name = seg.length >= 4 ? seg[2] : "Other";
    seasons.set(name, [...(seasons.get(name) ?? []), f]);
  }
  const order = [...seasons.keys()].sort((a, b) =>
    a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b, undefined, { numeric: true }));
  return { ...base, seasons: order.map((name) => ({ name, bytes: sum(seasons.get(name)!), files: seasons.get(name)!.sort(byBytes) })) };
}
