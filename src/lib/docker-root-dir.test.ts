import { beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// docker.ts imports "@/lib/...", which plain node cannot resolve; map it for this process only.
const SRC = new URL("../", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) return next(SRC + s.slice(2) + ".ts", c);
  return next(s, c);
}`));
const { docker, getDockerRootDir } = await import("./docker.ts");

const g = globalThis as unknown as { __dockerRootCache?: unknown };
const fake = docker as unknown as { info: (o: object) => Promise<{ DockerRootDir?: string }> };
const T0 = 1_000_000;
let asked = 0;
const answer = (impl: () => Promise<{ DockerRootDir?: string }>) => {
  asked = 0;
  fake.info = () => (asked++, impl());
};

beforeEach(() => {
  g.__dockerRootCache = undefined;
});

it("a failed lookup is asked again after 60 s, not an hour", async () => {
  answer(() => Promise.reject(new Error("timed out")));
  assert.equal(await getDockerRootDir(T0), null);
  assert.equal(await getDockerRootDir(T0 + 59_000), null);
  assert.equal(asked, 1, "still cached inside 60 s");
  answer(async () => ({ DockerRootDir: "/mnt/docker" }));
  assert.equal(await getDockerRootDir(T0 + 61_000), "/mnt/docker");
  assert.equal(asked, 1, "asked again after 61 s");
});

it("an answer is cached for the hour, including one with no DockerRootDir", async () => {
  answer(async () => ({ DockerRootDir: "/mnt/docker" }));
  assert.equal(await getDockerRootDir(T0), "/mnt/docker");
  assert.equal(await getDockerRootDir(T0 + 59 * 60_000), "/mnt/docker");
  assert.equal(asked, 1);
  assert.equal(await getDockerRootDir(T0 + 61 * 60_000), "/mnt/docker");
  assert.equal(asked, 2);

  g.__dockerRootCache = undefined;
  answer(async () => ({}));
  assert.equal(await getDockerRootDir(T0), null);
  assert.equal(await getDockerRootDir(T0 + 10 * 60_000), null);
  assert.equal(asked, 1, "a real answer without DockerRootDir keeps the hour");
});

it("a lookup that never settles falls back to null at the call deadline, then is retried after 60 s", async () => {
  const real = AbortSignal.timeout;
  const asked: number[] = [];
  AbortSignal.timeout = (ms: number) => (asked.push(ms), real.call(AbortSignal, 50)); // run the real abort path in 50 ms
  try {
    fake.info = (o) =>
      new Promise((_, reject) => {
        (o as { abortSignal: AbortSignal }).abortSignal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" })));
      });
    const t0 = Date.now();
    assert.equal(await getDockerRootDir(T0), null);
    assert.ok(Date.now() - t0 < 1000);
    assert.deepEqual(asked, [10_000], "the one-shot call deadline is DOCKER_CALL_MS");
    await getDockerRootDir(T0 + 30_000);
    assert.equal(asked.length, 1, "inside the 60 s window it is not asked again");
    await getDockerRootDir(T0 + 61_000);
    assert.equal(asked.length, 2);
  } finally {
    AbortSignal.timeout = real;
  }
});
