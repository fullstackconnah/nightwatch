/* Compiles src/lib/sunroom-light.ts with the repo's own tsc into a temp dir and imports it, so scripts read the
 * ramp the app ships instead of holding a second copy of the stop table. Shared by sunroom-contrast.mjs and
 * gen-sunroom-css.mjs. Invokes tsc's entry with the current node binary: on Windows, spawning the .cmd shim
 * without a shell fails with EINVAL. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadRamp() {
  const outDir = mkdtempSync(join(tmpdir(), "sunroom-ramp-"));
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  execFileSync(
    process.execPath,
    [tsc, join(ROOT, "src/lib/sunroom-light.ts"), "--outDir", outDir, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler"],
    { stdio: "pipe" },
  );
  const mod = await import(pathToFileURL(join(outDir, "sunroom-light.js")).href);
  return { mod, cleanup: () => rmSync(outDir, { recursive: true, force: true }) };
}
