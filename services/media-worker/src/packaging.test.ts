// Source-text checks on the files that ship the worker: compose, Dockerfile, ignore files, CI.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = new URL("../../../", import.meta.url);
const WORKER = new URL("../", import.meta.url);
const read = (base: URL, rel: string) => readFileSync(new URL(rel, base), "utf8").replace(/\r\n/g, "\n");

/** The lines of one top-level service in a compose file. */
function serviceBlock(compose: string, name: string): string {
  const lines = compose.split("\n");
  const from = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(from >= 0, `service ${name} not found`);
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i++) if (/^( {0,2})\S/.test(lines[i]) && !lines[i].startsWith("   ")) { to = i; break; }
  return lines.slice(from, to).join("\n");
}

describe("compose files", () => {
  const live = read(WORKER, "compose.yaml");
  const test = read(REPO, "docker-compose.test.yml");
  const prod = read(REPO, "docker-compose.yml");

  it("live stack mounts /mnt/media read-only, in one bind", () => {
    const binds = live.split("\n").filter((l) => /^\s+- \/mnt\/media/.test(l));
    assert.deepEqual(binds.map((l) => l.trim()), ["- /mnt/media:/mnt/media:ro"]);
  });

  it("live stack never sets the test-threshold variable (N1, N11)", () => {
    assert.ok(!live.includes("MEDIA_WORKER_TEST_THRESHOLDS"));
  });

  it("live stack publishes only on the LAN address from .env, with limits", () => {
    assert.match(live, /"\$\{MEDIA_WORKER_BIND:\?[^}]+\}:8091:8091"/);
    assert.match(live, /user: "\$\{PUID:\?[^}]+\}:\$\{PGID:\?[^}]+\}"/);
    assert.match(live, /cpus: "8"/);
    assert.match(live, /mem_limit: 4g/);
    assert.match(live, /restart: unless-stopped/);
    assert.match(live, /\.\/state:\/state/);
  });

  it("test stack: read-only mount, internal network, no ports, placeholder token", () => {
    const block = serviceBlock(test, "media-worker");
    assert.match(block, /build: \.\/services\/media-worker/);
    assert.match(block, /- \.\/test-media:\/mnt\/media:ro/);
    assert.match(block, /MEDIA_WORKER_TEST_THRESHOLDS=1/);
    assert.match(block, /MEDIA_WORKER_TOKEN=test-media-worker-token-not-secret-000000/);
    assert.match(block, /- internal/);
    assert.match(block, /dashboard\.enable=false/);
    assert.doesNotMatch(block, /\bports:/);
  });

  it("the socket proxy stays read-only in the test stack", () => {
    const block = serviceBlock(test, "socket-proxy");
    assert.match(block, /- POST=0/);
    assert.match(block, /- EXEC=0/);
  });

  it("the prod compose file knows nothing of the worker", () => {
    assert.doesNotMatch(prod, /media-worker|MEDIA_WORKER/);
  });
});

describe("image and ignore files", () => {
  it("the dashboard image keeps only the shared types file from services/ (M1)", () => {
    const lines = read(REPO, ".dockerignore").split("\n").map((l) => l.trim());
    assert.ok(lines.includes("services/*"));
    assert.ok(lines.includes("!services/media-worker/src/types.ts"));
    assert.ok(lines.includes("test-media"));
    assert.ok(lines.indexOf("!services/media-worker/src/types.ts") > lines.indexOf("services/*"), "re-include must come after the exclude");
  });

  it("types.ts imports nothing", () => {
    const src = read(WORKER, "src/types.ts");
    assert.doesNotMatch(src, /^\s*import\b/m);
    assert.doesNotMatch(src, /\brequire\(|import\(/);
  });

  it("test-media is gitignored", () => {
    assert.match(read(REPO, ".gitignore"), /^test-media\/$/m);
  });

  it("the Dockerfile fails the build if ionice or libx265 is missing (N7)", () => {
    const d = read(WORKER, "Dockerfile");
    assert.match(d, /^FROM node:22-alpine$/m);
    assert.match(d, /apk add --no-cache ffmpeg util-linux/);
    assert.match(d, /^RUN .*ionice -c 3 true.*libx265/m);
    assert.match(d, /CMD \["node", ?"--experimental-strip-types", ?"src\/server\.ts"\]/);
  });

  it(".env.example holds placeholders only", () => {
    const env = read(WORKER, ".env.example");
    for (const key of ["MEDIA_WORKER_TOKEN", "MEDIA_WORKER_BIND", "PUID", "PGID"]) assert.match(env, new RegExp(`^${key}=$`, "m"));
    assert.match(env, /^TZ=Australia\/Sydney$/m);
  });

  it("root npm test runs the worker suites, and CI installs ffmpeg", () => {
    const pkg = JSON.parse(read(REPO, "package.json"));
    assert.match(pkg.scripts.test, /"services\/\*\*\/\*\.test\.ts"/);
    const ci = read(REPO, ".github/workflows/ci.yml");
    assert.match(ci, /apt-get install -y --no-install-recommends ffmpeg/);
    assert.ok(ci.indexOf("apt-get install") < ci.indexOf("npm test"));
  });
});

describe("source rules", () => {
  const files = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) files(join(dir, e.name), out);
      else out.push(join(dir, e.name));
    }
    return out;
  };

  it("only state.ts writes to disk (the media mount is read-only by construction)", () => {
    const WRITES = /\b(writeFile(Sync)?|appendFile(Sync)?|rename(Sync)?|unlink(Sync)?|rm(Sync)?|rmdir(Sync)?|mkdir(Sync)?|copyFile(Sync)?|truncate(Sync)?|symlink(Sync)?|link(Sync)?|createWriteStream|openSync|utimes(Sync)?|chmod(Sync)?|chown(Sync)?)\b/;
    const offenders = files(fileURLToPath(new URL("src/", WORKER)))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("testkit.ts") && !f.endsWith("state.ts"))
      .filter((f) => readFileSync(f, "utf8").split(/\r?\n/).some((l) => WRITES.test(l.replace(/\/\*.*$/, "").replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, ""))));
    assert.deepEqual(offenders, []);
  });

  it("no private address, and no real host, in the worker files or the compose files", () => {
    const PRIVATE = /\b(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/;
    // This file spells the pattern out, so it is the one exception.
    for (const f of files(fileURLToPath(WORKER)).filter((f) => !f.endsWith("packaging.test.ts"))) {
      assert.doesNotMatch(readFileSync(f, "utf8"), PRIVATE, f);
    }
    assert.doesNotMatch(serviceBlock(read(REPO, "docker-compose.test.yml"), "media-worker"), PRIVATE);
  });
});
