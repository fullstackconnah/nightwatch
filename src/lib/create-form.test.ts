import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkRows, type EnvRow, type PortRow, type VolRow } from "./create-form.ts";

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const port = (host: string, container: string): PortRow => ({ host, container, protocol: "tcp" });
const vol = (host: string, container: string): VolRow => ({ host, container, readonly: false });
const env = (key: string, value = ""): EnvRow => ({ key, value });
const err = (r: ReturnType<typeof checkRows>) => ("error" in r ? r.error : null);

test("a port row with one side is refused with its row number", () => {
  assert.equal(err(checkRows([port("8080", "")], [], [])), "Port row 1 needs both a host and a container port.");
  assert.equal(err(checkRows([port("", "80")], [], [])), "Port row 1 needs both a host and a container port.");
  assert.equal(err(checkRows([port("8080", "80"), port("9090", " ")], [], [])), "Port row 2 needs both a host and a container port.");
});

test("an all-blank row is dropped but still counts in the numbering", () => {
  assert.equal(err(checkRows([port("", ""), port("1", "")], [], [])), "Port row 2 needs both a host and a container port.");
  const r = checkRows([port("", " "), port("8080", "80")], [env(" ", " ")], [vol("", "")]);
  assert.deepEqual(r, { ports: [{ host: 8080, container: 80, protocol: "tcp" }], env: [], volumes: [] });
});

test("an env row with a value and no name is refused", () => {
  assert.equal(err(checkRows([], [env("", "x")], [])), "Variable row 1 needs a name.");
  assert.equal(err(checkRows([], [env("A", "1"), env("  ", "x")], [])), "Variable row 2 needs a name.");
});

test("env keys are trimmed, values are sent as typed", () => {
  assert.deepEqual(checkRows([], [env(" A ", " x ")], []), { ports: [], env: [{ key: "A", value: " x " }], volumes: [] });
});

test("an env key with inner whitespace or = is refused", () => {
  const m = 'Variable row 1: the name cannot contain spaces or "=".';
  assert.equal(err(checkRows([], [env("A B")], [])), m);
  assert.equal(err(checkRows([], [env("A=B")], [])), m);
});

test("an env row with a name and a blank value is allowed", () => {
  assert.deepEqual(checkRows([], [env("A")], []), { ports: [], env: [{ key: "A", value: "" }], volumes: [] });
});

test("a volume row with one side is refused", () => {
  assert.equal(err(checkRows([], [], [vol("/a", "")])), "Volume row 1 needs both a host path and a container path.");
  assert.equal(err(checkRows([], [], [vol("/a", "/b"), vol("", "/c")])), "Volume row 2 needs both a host path and a container path.");
});

test("only the first problem is reported: ports, then env, then volumes", () => {
  assert.equal(err(checkRows([port("1", "")], [env("", "x")], [vol("/a", "")])), "Port row 1 needs both a host and a container port.");
  assert.equal(err(checkRows([], [env("", "x")], [vol("/a", "")])), "Variable row 1 needs a name.");
});

test("complete rows come out as the component used to send them", () => {
  const v = vol("/a", "/b");
  assert.deepEqual(
    checkRows([{ host: "8080", container: "80", protocol: "udp" }], [env("K", "v")], [v]),
    { ports: [{ host: 8080, container: 80, protocol: "udp" }], env: [{ key: "K", value: "v" }], volumes: [v] },
  );
});

test("the dialog cannot be closed while it is creating", () => {
  const s = src("components/resources/create-container.tsx");
  assert.match(s, /<Button variant="outline" disabled=\{busy\} onClick=\{onClose\}>Cancel<\/Button>/);
  assert.match(s, /onClick=\{onClose\}\s+disabled=\{busy\}\s+aria-label="Close"/);
  assert.match(s, /e\.key === "Escape"[\s\S]{0,80}if \(!busy\) onClose\(\)/);
  assert.match(s, /<p role="alert" className="text-bad text-xs">\{error\}<\/p>/);
});
