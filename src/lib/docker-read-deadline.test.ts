import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { isDeadlineError } from "./docker-deadline.ts";

const Docker = createRequire(import.meta.url)("dockerode");
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const DL = String.raw`abortSignal: AbortSignal\.timeout\(DOCKER_CALL_MS\)`;

test("dockerode read calls give up on an aborted signal when dockerd never answers", { timeout: 8000 }, async () => {
  const server = createServer(() => {});
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const docker = new Docker({ host: "127.0.0.1", port: (server.address() as { port: number }).port, protocol: "http" });
  try {
    for (const call of [
      (o: object) => docker.listNetworks(o),
      (o: object) => docker.listImages(o),
      (o: object) => docker.listVolumes(o),
      (o: object) => docker.df(o),
      (o: object) => docker.info(o),
      (o: object) => docker.getVolume("v").inspect(o),
    ]) {
      const err = await call({ abortSignal: AbortSignal.timeout(150) }).then(() => null, (e: unknown) => e);
      assert.ok(isDeadlineError(err));
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("every one-shot docker read carries the call deadline", () => {
  const sites: [string, RegExp][] = [
    ["./network.ts", new RegExp(String.raw`docker\.listNetworks\(\{ ${DL} \}\)`)],
    ["./docker.ts", new RegExp(String.raw`dockerRead\(\)\.df\(\{ ${DL} \}\)`)],
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
});
