import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveChanges,
  firstHit,
  parseSince,
  pruneRestartCounts,
  PENDING,
  runProbes,
  sortHits,
  toHits,
  type AttentionHit,
  type ProbeDef,
  type RawHit,
} from "./attention-report.ts";
import type { RuntimeContainer } from "./docker.ts";
import type { BackupStatus } from "./backup-status.ts";

const raw = (subject: string, severity: "warn" | "bad" = "bad", since?: string): RawHit => ({
  subject,
  severity,
  headline: `${subject} h`,
  detail: `${subject} d`,
  action: `${subject} a`,
  since,
});
const def = (id: ProbeDef["id"], run: ProbeDef["run"]): ProbeDef => ({ id, label: id, run });
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const DAY = 86_400_000;

// --- runProbes ---
test("answered with 2 hits", async () => {
  const [o] = await runProbes([def("crashes", () => [raw("container:a"), raw("container:b")])], 50);
  assert.deepEqual(o.status, { id: "crashes", label: "crashes", state: "answered", hits: 2 });
  assert.equal(o.hits.length, 2);
});

test("a probe that resolves after the deadline is pending and its late hits are dropped", async () => {
  const slow = def("smart", () => new Promise<RawHit[]>((r) => setTimeout(() => r([raw("array")]), 120)));
  const [o] = await runProbes([slow], 20);
  assert.equal(o.status.state, "pending");
  assert.equal(o.hits.length, 0);
});

test("isLate is true once the deadline timer has fired, false before", async () => {
  const seen: Record<string, boolean> = {};
  const probe = (id: ProbeDef["id"], ms: number): ProbeDef =>
    def(id, (isLate) => new Promise<RawHit[]>((r) => setTimeout(() => ((seen[id] = isLate()), r([])), ms)));
  const out = await runProbes([probe("smart", 120), probe("mounts", 0)], 40);
  assert.deepEqual(out.map((o) => o.status.state), ["pending", "answered"]);
  await new Promise((r) => setTimeout(r, 150)); // let the late probe finish
  assert.deepEqual(seen, { mounts: false, smart: true });
});

test("a probe that returns PENDING is pending", async () => {
  const [o] = await runProbes([def("orchestra", () => PENDING)], 50);
  assert.equal(o.status.state, "pending");
});

test("a throw is failed with the error text, 0 hits, never answered; the report is not all-answered", async () => {
  const out = await runProbes(
    [
      def("crashes", () => {
        throw new Error("socket /var/run/docker.sock refused");
      }),
      def("restarts", () => []),
      def("smart", async () => []),
    ],
    50,
  );
  assert.deepEqual(out[0].status, {
    id: "crashes",
    label: "crashes",
    state: "failed",
    error: "socket /var/run/docker.sock refused",
  });
  assert.equal(out[0].hits.length, 0);
  assert.ok(!out.every((o) => o.status.state === "answered"));
});

test("a long error is clipped to 140", async () => {
  const [o] = await runProbes([def("mounts", () => Promise.reject(new Error("x".repeat(400))))], 50);
  assert.equal(o.status.state === "failed" && o.status.error.length, 140);
});

test("one Docker error fails crashes, restarts and health with the same error", async () => {
  const err = new Error("docker down");
  const boom = () => {
    throw err;
  };
  const out = await runProbes([def("crashes", boom), def("restarts", boom), def("smart", () => []), def("health", boom)], 50);
  const errors = out.filter((o) => o.status.state === "failed").map((o) => (o.status as { error: string }).error);
  assert.deepEqual(errors, ["docker down", "docker down", "docker down"]);
});

// --- firstHit parity with the old sequential walk ---
function sequentialFirst(sets: RawHit[][]) {
  for (const s of sets) {
    const h = s[0];
    if (h) return { status: "attention", severity: h.severity, headline: h.headline, detail: h.detail, action: h.action, since: h.since };
  }
  return { status: "quiet" };
}
const PROBES: ProbeDef["id"][] = ["crashes", "restarts", "smart", "mounts", "backup", "disks", "health", "orchestra"];
async function viaReport(sets: (RawHit[] | "throw")[]) {
  const defs = sets.map((s, i) =>
    def(PROBES[i], () => {
      if (s === "throw") throw new Error("x");
      return s;
    }),
  );
  const ordered = toHits(await runProbes(defs, 50), () => "2026-11-04T00:00:00.000Z");
  return JSON.stringify(firstHit(ordered));
}
const fixtures: [string, (RawHit[] | "throw")[]][] = [
  ["all quiet", [[], [], [], [], [], [], [], []]],
  ["a throw is skipped, later hit wins", ["throw", [], [raw("array", "bad", "2026-11-03T00:00:00.000Z")], [raw("mount:/m")], [], [], [], []]],
  ["first of two in one probe, earlier probe wins", [[], [raw("container:r1"), raw("container:r2")], [], [], [], [raw("disk:/m", "warn")], [raw("container:h", "warn")], []]],
];
for (const [name, sets] of fixtures) {
  test(`firstHit parity: ${name}`, async () => {
    const expected = JSON.stringify(sequentialFirst(sets.map((s) => (s === "throw" ? [] : s))));
    assert.equal(await viaReport(sets), expected);
  });
}

// --- sortHits ---
const H = (id: string, severity: "warn" | "bad", firstSeen: string, since?: string): AttentionHit => ({
  id,
  probe: "crashes",
  subject: id,
  severity,
  headline: id,
  since,
  firstSeen,
  owner: { href: "/", label: "x" },
});
test("sortHits: bad first, then oldest; firstSeen stands in for a missing since", () => {
  const sorted = sortHits([
    H("w-old", "warn", "2026-11-01T00:00:00.000Z"),
    H("b-new", "bad", "2026-11-04T00:00:00.000Z"),
    H("b-old-since", "bad", "2026-11-04T01:00:00.000Z", "2026-11-02T00:00:00.000Z"),
    H("b-mid", "bad", "2026-11-03T00:00:00.000Z"),
  ]);
  assert.deepEqual(sorted.map((h) => h.id), ["b-old-since", "b-mid", "b-new", "w-old"]);
});

// --- parseSince ---
test("parseSince", () => {
  const fb = NOW - DAY;
  assert.equal(parseSince(undefined, NOW), fb);
  assert.equal(parseSince(null, NOW), fb);
  assert.equal(parseSince("abc", NOW), fb);
  assert.equal(parseSince("-1", NOW), fb);
  assert.equal(parseSince(String(NOW + 5000), NOW), fb);
  assert.equal(parseSince(String(NOW - 40 * DAY), NOW), NOW - 30 * DAY);
  assert.equal(parseSince(String(NOW - 3600_000), NOW), NOW - 3600_000);
});

// --- deriveChanges ---
const ctr = (o: Partial<RuntimeContainer>): RuntimeContainer =>
  ({
    id: o.name ?? "id",
    name: "c",
    state: "running",
    composeProject: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    restartCount: 0,
    ...o,
  }) as RuntimeContainer;
const SINCE = NOW - 3600_000;

test("the since filter: since-1 ms is out, since+1 ms is in", () => {
  const ev = deriveChanges([ctr({ name: "old", startedAt: SINCE - 1 }), ctr({ name: "new", startedAt: SINCE + 1 })], null, SINCE, []);
  assert.deepEqual(ev.map((e) => e.subjects), [["container:new"]]);
});

test("compose project and start minute group; restartCount > 0 is handled", () => {
  const t = SINCE + 600_000;
  const ev = deriveChanges(
    [
      ctr({ name: "web", composeProject: "app", startedAt: t }),
      ctr({ name: "db", composeProject: "app", startedAt: t + 5_000 }),
      ctr({ name: "solo", startedAt: t, restartCount: 2 }),
    ],
    null,
    SINCE,
    [],
  );
  const routine = ev.find((e) => e.kind === "routine")!;
  assert.deepEqual(routine.subjects.sort(), ["container:db", "container:web"]);
  assert.match(routine.text, /started$/);
  const handled = ev.find((e) => e.kind === "handled")!;
  assert.equal(handled.text, "solo restarted itself and is running again");
});

test("an exited container reads 'stopped (exit 137)'", () => {
  const ev = deriveChanges([ctr({ name: "x", state: "exited", finishedAt: SINCE + 10, exitCode: 137 })], null, SINCE, []);
  assert.equal(ev[0].text, "x stopped (exit 137)");
});

const backupOk: BackupStatus = {
  status: "ok",
  checkedAt: new Date(NOW).toISOString(),
  items: [
    { kind: "backup", state: "OK", at: new Date(SINCE + 1000).toISOString() },
    { kind: "restore-test", state: "FAILED", at: new Date(SINCE + 2000).toISOString() },
  ],
};
test("a backup OK event after since; FAILED items are not events", () => {
  const ev = deriveChanges([], backupOk, SINCE, []);
  assert.deepEqual(ev.map((e) => [e.subjects, e.text]), [[["backup"], "Nightly backup ran and passed"]]);
});

test("radarr crashed in hitSubjects gives no radarr event", () => {
  const c = ctr({ name: "radarr", state: "exited", finishedAt: SINCE + 10, exitCode: 1 });
  assert.equal(deriveChanges([c], null, SINCE, ["container:radarr"]).length, 0);
  assert.equal(deriveChanges([c], null, SINCE, []).length, 1);
});

test("no event carries an attention headline", () => {
  const ev = deriveChanges([ctr({ name: "radarr", state: "exited", finishedAt: SINCE + 10, exitCode: 1 })], backupOk, SINCE, ["container:radarr"]);
  for (const e of ev) assert.ok(!/is down|keeps restarting|crashed/i.test(e.text));
});

test("events are newest first", () => {
  const ev = deriveChanges([ctr({ name: "a", startedAt: SINCE + 10 }), ctr({ name: "b", startedAt: SINCE + 90_000 })], null, SINCE, []);
  assert.deepEqual(ev.map((e) => e.subjects[0]), ["container:b", "container:a"]);
});

test("Docker failed: no containers, backup events kept", () => {
  const ev = deriveChanges([], backupOk, SINCE, []);
  assert.equal(ev.length, 1);
});

test("pruneRestartCounts: drops containers that are gone, keeps the rest", () => {
  const counts = new Map([["a", 1], ["gone", 4]]);
  pruneRestartCounts(counts, ["a", "b"]);
  assert.deepEqual([...counts.keys()], ["a"]);
});
