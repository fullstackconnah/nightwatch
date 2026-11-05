import assert from "node:assert/strict";
// Helpers shared by the worker's tests; not itself a test file.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer, type ServerOpts } from "./server.ts";

export const TOKEN = "test-token-0123456789-0123456789-abcdef";

/** Suites that touch the fs, processes or ffmpeg skip off Linux; CI (Linux) runs them. */
export const SKIP_OFF_LINUX: string | false = process.platform === "linux" ? false : "needs Linux (fs, processes, ffmpeg)";

export function ffmpegMissing(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

export function tempDir(prefix = "mw-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export interface Started {
  r: RunningServer;
  base: string;
  auth: { authorization: string };
  logs: string[];
  stop(): Promise<void>;
}

export async function start(over: Partial<ServerOpts> = {}): Promise<Started> {
  const stateDir = tempDir("mw-state-");
  const logs: string[] = [];
  const r = await startServer({
    token: TOKEN, mediaRoot: over.mediaRoot ?? tempDir("mw-media-"), stateDir,
    scanOnBoot: false, nightly: false, env: {}, log: (l) => logs.push(l), ...over,
  });
  return {
    r, base: `http://127.0.0.1:${r.port}`, auth: { authorization: `Bearer ${TOKEN}` }, logs,
    stop: async () => { await r.close(); rmSync(stateDir, { recursive: true, force: true }); },
  };
}

/** True when ffmpeg is there. Missing: CI fails ("CI must install ffmpeg"), a local run skips. */
export function needFfmpeg(t: object): boolean {
  if (!ffmpegMissing()) return true;
  assert.ok(!process.env.CI, "CI must install ffmpeg");
  (t as { skip?(msg?: string): void }).skip?.("ffmpeg is not installed");
  return false;
}
