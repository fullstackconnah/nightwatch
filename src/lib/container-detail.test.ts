import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shapeContainerDetail } from "./container-detail.ts";

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
  assert.deepEqual(out.env, ["SECRET_KEY=VALUE1"]); // env is still rendered by the page: NEEDS DECISION
  assert.deepEqual(out.ports, [{ container: "80/tcp", host: ["0.0.0.0:8080"] }]);
  assert.equal(out.cmd, "nginx -g");
});

test("the route builds its response with the shaper", () => {
  const src = readFileSync(fileURLToPath(new URL("../app/api/docker/containers/[id]/route.ts", import.meta.url)), "utf8");
  assert.match(src, /shapeContainerDetail\(info\)/);
  assert.doesNotMatch(src, /Labels \|\| \{\}/);
});
