import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { envValue, shapeContainerDetail } from "./container-detail.ts";
import { kioskMayCall } from "./kiosk-access.ts";

const info = {
  Id: "abc123",
  Name: "/web",
  Created: "2026-01-01T00:00:00Z",
  RestartCount: 2,
  State: { Status: "running", Running: true, StartedAt: "s", ExitCode: 0, OOMKilled: false, Health: { Status: "healthy" } },
  HostConfig: { RestartPolicy: { Name: "always" }, NetworkMode: "bridge" },
  NetworkSettings: { Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] } },
  Mounts: [{ Source: "/a", Destination: "/b", RW: true, Type: "bind" }],
  Config: {
    Image: "nginx",
    Env: ["SECRET_KEY=VALUE1"],
    Labels: { "x.example": "VALUE2", "com.docker.compose.project": "p", "com.docker.compose.service": "s" },
    Cmd: ["nginx", "-g"],
    Tty: false,
  },
};

test("detail response drops labels but keeps every other field", () => {
  const out = shapeContainerDetail(info as never) as Record<string, unknown>;
  assert.equal("labels" in out, false);
  assert.doesNotMatch(JSON.stringify(out), /VALUE2/);
  assert.deepEqual(Object.keys(out).sort(), [
    "cmd", "composeProject", "composeService", "created", "env", "id", "image", "mounts",
    "name", "networkMode", "ports", "restartPolicy", "state", "tty",
  ]);
  assert.equal(out.name, "web");
  assert.equal(out.composeProject, "p");
  assert.deepEqual(out.env, ["SECRET_KEY"]); // names only: values come one at a time from the /env route
  assert.doesNotMatch(JSON.stringify(out), /VALUE1/);
  assert.deepEqual(out.ports, [{ container: "80/tcp", host: ["0.0.0.0:8080"] }]);
  assert.equal(out.cmd, "nginx -g");
});

test("the route builds its response with the shaper", () => {
  const src = readFileSync(fileURLToPath(new URL("../app/api/docker/containers/[id]/route.ts", import.meta.url)), "utf8");
  assert.match(src, /shapeContainerDetail\(info\)/);
  assert.doesNotMatch(src, /Labels \|\| \{\}/);
});

test("envValue: first match wins, value is everything after the first =", () => {
  const env = ["A=1", "B=", "C=x=y=z", "A=2", "BARE"];
  assert.equal(envValue(env, "A"), "1");
  assert.equal(envValue(env, "B"), "");
  assert.equal(envValue(env, "C"), "x=y=z");
  assert.equal(envValue(env, "BARE"), "");
  assert.equal(envValue(env, "MISSING"), undefined);
  assert.equal(envValue(env, "A=1"), undefined); // the name is never a prefix match
});

test("shaped env lists the name of an entry without = and splits at the first =", () => {
  const out = shapeContainerDetail({ ...info, Config: { ...info.Config, Env: ["BARE", "C=x=y"] } } as never);
  assert.deepEqual(out.env, ["BARE", "C"]);
});

test("shaped env drops an entry whose name is empty", () => {
  const out = shapeContainerDetail({ ...info, Config: { ...info.Config, Env: ["=x", "A=1"] } } as never);
  assert.deepEqual(out.env, ["A"]);
});

test("the env route is no-store, validates name, uses envValue, and is not on the kiosk allow-list", () => {
  const src = readFileSync(fileURLToPath(new URL("../app/api/docker/containers/[id]/env/route.ts", import.meta.url)), "utf8");
  assert.match(src, /no-store/);
  assert.match(src, /name\.length > 256|length > 256/);
  assert.match(src, /envValue\(/);
  assert.equal(kioskMayCall("GET", "/api/docker/containers/abc123/env"), false);
});

test("the page fetches values one at a time and never renders NAME=VALUE entries", () => {
  const src = readFileSync(fileURLToPath(new URL("../app/(dash)/containers/[id]/page.tsx", import.meta.url)), "utf8");
  assert.match(src, /\/env\?name=/);
  assert.doesNotMatch(src, /info\.env\.map\(\(e, i\)/);
  assert.doesNotMatch(src, /click to reveal/);
  for (const s of ["show names", "Loading…", "Couldn&apos;t load","(empty)", "Retry", "••••••••", "\"Hide\" : \"Show\"} value of ${n}"]) {
    assert.ok(src.includes(s), `page holds "${s}"`);
  }
  assert.doesNotMatch(src, /localStorage/);
  assert.match(src, /<EnvRows key=\{id \+ "\\n" \+ info\.env\.join/); // a reveal never reads another container by an old name list
});
