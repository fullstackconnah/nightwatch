import fs from "node:fs";
import path from "node:path";
import { dataDir, writeJsonAtomic } from "./config.ts";

/** When each attention hit was first seen, saved so a restart keeps ongoing conditions' age and kiosk alert ids. */
const MAX_BYTES = 64 * 1024;
const MAX_ENTRIES = 500;
const MAX_KEY = 200;
const FUTURE_SLACK_MS = 60_000;
const defaultFile = (): string => path.join(dataDir(), "attention-first-seen.json");

export function loadFirstSeen(file: string = defaultFile()): Map<string, string> {
  const out = new Map<string, string>();
  try {
    if (fs.statSync(file).size > MAX_BYTES) return out;
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    const limit = Date.now() + FUTURE_SLACK_MS;
    for (const [k, v] of Object.entries(raw)) {
      if (out.size >= MAX_ENTRIES) break;
      if (!k || k.length > MAX_KEY || typeof v !== "string") continue;
      const t = Date.parse(v);
      if (Number.isNaN(t) || t > limit) continue;
      out.set(k, v);
    }
  } catch {
    return new Map();
  }
  return out;
}

let warned = false;

export function saveFirstSeen(map: Map<string, string>, file: string = defaultFile()): void {
  try {
    writeJsonAtomic(file, Object.fromEntries(map));
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn("[attention] could not save first-seen times, keeping them in memory:", (e as Error).message);
    }
  }
}
