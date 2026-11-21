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

test("the env-name message carries the row number of a later row", () => {
  assert.equal(err(checkRows([], [env("A"), env("B C")], [])), 'Variable row 2: the name cannot contain spaces or "=".');
  assert.equal(err(checkRows([], [env("A"), env("B=C")], [])), 'Variable row 2: the name cannot contain spaces or "=".');
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

test("while creating, focus stays on a submit that is aria-disabled, not disabled", () => {
  const s = src("components/resources/create-container.tsx");
  // the empty-image case stays a real disabled; the busy case is aria-disabled only
  assert.match(s, /disabled=\{!image\.trim\(\)\}/);
  assert.match(s, /aria-disabled=\{busy \|\| undefined\}/);
  assert.doesNotMatch(s, /disabled=\{busy \|\| !image\.trim\(\)\}/);
  // same dimmed look as `disabled`, no pointer events
  assert.match(s, /aria-disabled:opacity-40 aria-disabled:pointer-events-none/);
  // a second click or Enter does nothing, and it is the first statement of submit
  assert.match(s, /async function submit\(\) \{\s*if \(busy\) return;/);
  // focus moves to the submit button as busy starts, before the request is awaited
  const body = s.slice(s.indexOf("async function submit()"), s.indexOf("  return ("));
  const busyAt = body.indexOf("setBusy(true)");
  const focusAt = body.indexOf("submitRef.current?.focus()");
  assert.ok(busyAt >= 0 && focusAt > busyAt && focusAt < body.indexOf("await postJson("));
  assert.match(s, /<Button\s+ref=\{submitRef\}/);
  // a refused submit returns before busy starts, so focus stays where it was
  assert.ok(body.indexOf('"error" in rows') < busyAt);
});

const hostMsg = (n: number) => `Port row ${n}: the host port must be a whole number from 1 to 65535.`;
const contMsg = (n: number) => `Port row ${n}: the container port must be a whole number from 1 to 65535.`;

test("a host port that is not a whole number from 1 to 65535 is refused, naming the row", () => {
  for (const bad of ["8000-8010", "abc", "0", "80.5", "70000", "-1", "1e3"]) {
    assert.equal(err(checkRows([port("8080", "80"), port(bad, "80")], [], [])), hostMsg(2), bad);
  }
});

test("a bad container port gets the container message; both bad reports the host", () => {
  assert.equal(err(checkRows([port("8080", "80-90")], [], [])), contMsg(1));
  assert.equal(err(checkRows([port("8080", "65536")], [], [])), contMsg(1));
  assert.equal(err(checkRows([port("x", "y")], [], [])), hostMsg(1));
});

test("valid ports pass as numbers, trimmed, with the edges 1 and 65535", () => {
  const r = checkRows([port("8080", "80"), port(" 8080 ", " 80 "), port("1", "65535"), port("080", "80")], [], []);
  assert.deepEqual(r, {
    ports: [
      { host: 8080, container: 80, protocol: "tcp" },
      { host: 8080, container: 80, protocol: "tcp" },
      { host: 1, container: 65535, protocol: "tcp" },
      { host: 80, container: 80, protocol: "tcp" },
    ],
    env: [],
    volumes: [],
  });
});
