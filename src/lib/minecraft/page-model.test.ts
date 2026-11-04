import test from "node:test";
import assert from "node:assert/strict";
import { leadFor, minecraftModel, type McContainer, type Model, type ModelInput, type WriteId } from "./page-model.ts";

const NOW = Date.parse("2026-11-04T10:00:00Z");
const pack = (slug: string, name: string) => ({
  slug, name, source: "modrinth" as const, packRef: slug, mcVersion: "1.21.1", memoryGb: 6, createdAt: "2026-10-01T00:00:00Z",
});
const running: McContainer = { state: "running", exitCode: null, startedAt: NOW - 3 * 3600_000 };
const status = (o: Record<string, unknown> = {}) => ({
  manager: "ok" as const,
  instances: [pack("atm10", "ATM10")],
  active: "atm10",
  players: { online: 2, max: 10, players: ["Ann", "Bo"] },
  rcon: "ok" as const,
  ...o,
});
const backup = (hoursAgo: number, file = `atm10-${hoursAgo}.tar.gz`) => ({
  instance: "atm10", file, sizeBytes: 1048576, modifiedAt: new Date(NOW - hoursAgo * 3600_000).toISOString(),
});
function input(o: Partial<ModelInput> = {}): ModelInput {
  return {
    status: status(), statusError: false, container: running, containersReady: true,
    backups: [backup(6), backup(30), backup(54), backup(78), backup(102)], backupsError: false,
    lastLine: "[10:00:00] Done (41.2s)!", lastOkAt: NOW - 4000, now: NOW, ...o,
  };
}
const w = (m: Model, id: WriteId) => m.writes.find((x) => x.id === id)!;
// log-pause is a reversible view toggle, not a write: asserted on its own
const enabled = (m: Model) => m.writes.filter((x) => x.enabled && x.id !== "log-pause").map((x) => x.id).sort();
const crashedC: McContainer = { state: "exited", exitCode: 1, startedAt: null };

test("loading: Checking, nothing writable, no strip opens by itself", () => {
  const m = minecraftModel(input({ status: undefined, lastOkAt: null }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Checking" });
  assert.equal(m.answer, "Connecting to mc-manager…");
  assert.equal(m.evidence, "First answer usually takes a second");
  assert.deepEqual(enabled(m), []);
  assert.equal(m.autoTarget, "keep");
});

test("containers still loading counts as loading", () => {
  assert.equal(minecraftModel(input({ containersReady: false, container: undefined })).chip.label, "Checking");
});

test("unconfigured: no strips, says what is missing, links to Settings", () => {
  const m = minecraftModel(input({ status: status({ manager: "unconfigured", instances: [], active: null }) }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Not connected" });
  assert.equal(m.answer, "Minecraft isn’t connected yet.");
  assert.equal(m.evidence, "Add the mc-manager address and token in Settings → Integrations.");
  assert.deepEqual(m.link, { href: "/settings#integrations", label: "Open Settings" });
  assert.deepEqual(m.strips, []);
  assert.deepEqual(enabled(m), []);
});

test("token rejected: warn, Server opens, only Start/Stop/Restart work", () => {
  const m = minecraftModel(input({ status: status({ manager: "unauthorized", instances: [], active: null, players: null, rcon: "unconfigured" }) }));
  assert.deepEqual(m.chip, { tone: "warn", label: "Token rejected" });
  assert.equal(m.answer, "mc-manager rejected the token. Check it in Settings → Integrations.");
  assert.deepEqual(m.link, { href: "/settings#integrations", label: "Open Settings" });
  assert.equal(m.autoTarget, "server");
  assert.deepEqual(enabled(m), ["restart", "stop"]);
});

test("down: warn, Server opens, why-line notice, Docker verbs still work", () => {
  const m = minecraftModel(input({ status: status({ manager: "unreachable", managerDetail: "connect refused", instances: [], active: null, players: null }) }));
  assert.deepEqual(m.chip, { tone: "warn", label: "Manager down" });
  assert.equal(m.answer, "Docker says the server is running, but mc-manager isn’t answering. Packs, console and backups are paused.");
  assert.equal(m.notice, "Start, stop and restart still work through Docker.");
  assert.equal(m.autoTarget, "server");
  assert.deepEqual(enabled(m), ["restart", "stop"]);
});

test("crashed: bad, Server opens, order puts the Log second, Start and Restore work", () => {
  const m = minecraftModel(input({ container: crashedC }));
  assert.deepEqual(m.chip, { tone: "bad", label: "Crashed" });
  assert.equal(m.answer, "Minecraft is stopped: ATM10 failed to install.");
  assert.equal(m.autoTarget, "server");
  assert.deepEqual(m.order, ["server", "log", "pack", "backups", "players", "console"]);
  assert.deepEqual(m.strips[0], { id: "server", title: "Server", state: "Stopped: exit code 1", tone: "bad" });
  assert.equal(w(m, "start").enabled, true);
  assert.equal(w(m, "restore").enabled, true);
  assert.equal(w(m, "backup-run").enabled, false);
  assert.equal(w(m, "stop").enabled, false);
});

test("a clean exit (0, 143, none) is stopped, not crashed", () => {
  for (const exitCode of [0, 143, null]) {
    const m = minecraftModel(input({ container: { state: "exited", exitCode, startedAt: null } }));
    assert.equal(m.chip.label, "Stopped");
    assert.equal(m.strips[0].state, "Stopped");
  }
});

test("no pack: Pack opens and goes first", () => {
  const m = minecraftModel(input({ status: status({ instances: [], active: null }) }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "No pack" });
  assert.equal(m.answer, "No modpack installed yet. Find one below to install it.");
  assert.equal(m.autoTarget, "pack");
  assert.deepEqual(m.order, ["pack", "server", "backups", "players", "console", "log"]);
  assert.equal(m.strips[0].state, "No pack installed");
});

test("running, calm: default order, nothing opens, every write per section 6", () => {
  const m = minecraftModel(input());
  assert.deepEqual(m.chip, { tone: "ok", label: "Running" });
  assert.equal(m.answer, "Minecraft is running ATM10. 2 of 10 players online.");
  assert.equal(m.evidence, "Updated 4 s ago · checks every 10 s");
  assert.equal(m.notice, null);
  assert.equal(m.autoTarget, null);
  assert.deepEqual(m.order, ["server", "players", "pack", "backups", "console", "log"]);
  assert.deepEqual(m.strips.map((s) => s.state), [
    "Running for 3h 0m", "2 of 10 online", "ATM10 · modrinth", "Last 6 h ago · 5 kept", "Ready", "[10:00:00] Done (41.2s)!",
  ]);
  assert.ok(m.strips.every((s) => s.tone === null), "0 bad or warn tones on a healthy page");
  assert.deepEqual(enabled(m), ["backup-run", "console-send", "delete", "install", "restart", "stop", "switch", "upload"]);
  assert.equal(w(m, "restore").reason, "Stop the server to restore.");
});

test("nobody online, and the stopped server says how to back up", () => {
  const m = minecraftModel(input({ status: status({ players: { online: 0, max: 10, players: [] } }) }));
  assert.equal(m.answer, "Minecraft is running ATM10. Nobody is online.");
  assert.equal(m.strips[1].state, "Nobody online");
  const off = minecraftModel(input({ container: { state: "exited", exitCode: 0, startedAt: null } }));
  assert.equal(w(off, "backup-run").reason, "Start the server to back up.");
  assert.equal(w(off, "start").enabled, true);
});

test("partial: console not answering keeps Running, drops the count, turns Send off", () => {
  const m = minecraftModel(input({ status: status({ players: null, rcon: "unavailable" }) }));
  assert.deepEqual(m.chip, { tone: "ok", label: "Running" });
  assert.equal(m.answer, "Minecraft is running ATM10. Player count unknown: the console isn’t answering.");
  assert.equal(m.strips[1].state, "Unknown: the console isn’t answering");
  assert.equal(m.strips[4].state, "Not answering");
  assert.equal(m.autoTarget, null);
  assert.equal(w(m, "console-send").enabled, false);
  assert.equal(w(m, "stop").enabled, true);
});

test("first minutes of a boot read as Starting…", () => {
  const m = minecraftModel(input({ status: status({ players: null, rcon: "unavailable" }), container: { ...running, startedAt: NOW - 60_000 } }));
  assert.equal(m.strips[0].state, "Starting…");
});

test("stale: neutral chip, answer says how old, every write off, strips unchanged", () => {
  const m = minecraftModel(input({ statusError: true, lastOkAt: NOW - 40_000 }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Stale" });
  assert.equal(m.answer, "Showing what was true 40 s ago: minecraft is running ATM10. 2 of 10 players online.");
  assert.equal(m.evidence, "Last update 40 s ago · mc-manager stopped answering");
  assert.equal(m.notice, "Controls are paused while the page shows old data.");
  assert.equal(m.autoTarget, "keep");
  assert.deepEqual(enabled(m), []);
  assert.equal(w(m, "log-pause").enabled, true);
  // also stale when the poll has not failed but is older than 30 s
  assert.equal(minecraftModel(input({ lastOkAt: NOW - 31_000 })).chip.label, "Stale");
  assert.equal(minecraftModel(input({ lastOkAt: NOW - 29_000 })).chip.label, "Running");
});

test("backups line: warn only when they could not be read; empty and unknown are calm", () => {
  assert.deepEqual(minecraftModel(input({ backups: undefined, backupsError: true })).strips[3], { id: "backups", title: "Backups", state: "Couldn’t load backups", tone: "warn" });
  assert.equal(minecraftModel(input({ backups: [] })).strips[3].state, "No backups yet");
});

test("C4b: every fact in the answer is on screen without opening a strip, or leads the strip that opens itself", () => {
  const cases: [string, ModelInput, string[]][] = [
    ["calm", input(), ["ATM10", "2 of 10"]],
    ["partial", input({ status: status({ players: null, rcon: "unavailable" }) }), ["ATM10", "console", "answering"]],
    ["crashed", input({ container: crashedC }), ["ATM10", "exit code 1"]],
    ["stale", input({ statusError: true, lastOkAt: NOW - 40_000 }), ["ATM10", "40 s"]],
    ["no pack", input({ status: status({ instances: [], active: null }) }), ["modpack"]],
  ];
  for (const [name, inp, facts] of cases) {
    const m = minecraftModel(inp);
    const screen = [...m.strips.map((s) => s.state), m.evidence, m.notice ?? ""].join(" | ");
    const lead = typeof m.autoTarget === "string" && m.autoTarget !== "keep" ? (m.detailLead ?? "") : "";
    for (const f of facts) assert.ok(screen.includes(f) || lead.includes(f), `${name}: "${f}" missing`);
  }
});

test("the unauthorized and down models never show an address", () => {
  const m = minecraftModel(input({ status: status({ manager: "unreachable", managerDetail: "x", instances: [], active: null }) }));
  assert.doesNotMatch(JSON.stringify(m), /\b\d{1,3}(\.\d{1,3}){3}\b/);
});

test("the full answer leads only the strip the answer names (R3)", () => {
  const nopack = minecraftModel(input({ status: status({ instances: [], active: null }) }));
  assert.equal(leadFor(nopack, "pack"), nopack.answer);
  assert.equal(leadFor(nopack, "server"), null);
  const crashed = minecraftModel(input({ container: crashedC }));
  assert.equal(leadFor(crashed, "server"), crashed.answer);
  assert.equal(leadFor(crashed, "pack"), null);
});
