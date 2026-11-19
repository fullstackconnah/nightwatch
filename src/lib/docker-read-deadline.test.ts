import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const DL = String.raw`abortSignal: AbortSignal\.timeout\(DOCKER_CALL_MS\)`;

test("every one-shot docker read carries the call deadline", () => {
  const sites: [string, RegExp][] = [
    ["./network.ts", new RegExp(String.raw`docker\.listNetworks\(\{ ${DL} \}\)`)],
    ["./docker.ts", /dockerRead\(\)\.df\(\{ abortSignal: AbortSignal\.timeout\(DOCKER_DF_MS\) \}\)/],
    ["./docker.ts", new RegExp(String.raw`docker\.listImages\(\{ all: false, ${DL} \}\)`)],
    ["./docker.ts", new RegExp(String.raw`docker\.listVolumes\(\{ ${DL} \}\)`)],
    ["./docker.ts", new RegExp(String.raw`\.info\(\{ ${DL} \}\)`)],
    ["./docker.ts", new RegExp(String.raw`getVolume\(n\)\.inspect\(\{ ${DL} \}\)`)],
    ["../app/api/docker/networks/route.ts", new RegExp(String.raw`docker\.listNetworks\(\{ ${DL} \}\)`)],
    ["../app/api/docker/volumes/route.ts", new RegExp(String.raw`docker\.listVolumes\(\{ ${DL} \}\)`)],
    ["../app/api/docker/images/route.ts", new RegExp(String.raw`docker\.listImages\(\{ all: false, ${DL} \}\)`)],
    ["../app/api/docker/images/route.ts", new RegExp(String.raw`docker\.listContainers\(\{ all: true, ${DL} \}\)`)],
    ["../app/api/docker/images/[id]/route.ts", new RegExp(String.raw`docker\.listContainers\(\{ all: true, ${DL} \}\)`)],
    ["../app/api/docker/containers/[id]/route.ts", new RegExp(String.raw`inspect\(\{ ${DL} \}\)`)],
    ["../app/api/docker/containers/[id]/env/route.ts", new RegExp(String.raw`inspect\(\{ ${DL} \}\)`)],
  ];
  for (const [file, re] of sites) assert.match(src(file), re, file);
  assert.match(src("./docker.ts"), /export const DOCKER_CALL_MS = 10_000;/);
  assert.match(src("./docker.ts"), /const DOCKER_DF_MS = 90_000;/);
});
