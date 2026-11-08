import test from "node:test";
import assert from "node:assert/strict";
import {
  answerFor,
  calmLine,
  ageText,
  clock,
  dropListed,
  feedSlots,
  gate,
  homeRows,
  parseLastLooked,
  pillText,
  probeLine,
  reveal,
  slotOrder,
} from "./home.ts";
import { createRanker } from "./watchlist.ts";
import { nightlyAt } from "./backup-status.ts";
import type { AttentionHit, AttentionReport, ProbeId, ProbeStatus } from "./attention-report.ts";

const IDS: ProbeId[] = ["crashes", "restarts", "smart", "mounts", "backup", "disks", "health", "orchestra"];
const DOCKER: ProbeId[] = ["crashes", "restarts", "health"];
const answered = (id: ProbeId, hits = 0): ProbeStatus => ({ id, label: id, state: "answered", hits });
const failed = (id: ProbeId, error = "x"): ProbeStatus => ({ id, label: id, state: "failed", error });
const pending = (id: ProbeId): ProbeStatus => ({ id, label: id, state: "pending" });
/** Every probe answered except those overridden. */
const probes = (...over: ProbeStatus[]): ProbeStatus[] => IDS.map((id) => over.find((o) => o.id === id) ?? answered(id));
const hit = (
  probe: ProbeId,
  subject: string,
  severity: "warn" | "bad" = "bad",
  headline = "The radarr app crashed",
): AttentionHit => ({
  id: `${probe}:${subject}`,
  probe,
  subject,
  severity,
  headline,
  firstSeen: "2026-11-04T08:00:00.000Z",
  owner: { href: `/resources?q=${subject}`, label: "Open in Resources" },
});
const report = (over: Partial<AttentionReport> = {}): AttentionReport => ({
  checkedAt: "2026-11-04T08:30:00.000Z",
  probes: probes(),
  hits: [],
  changes: { since: "2026-11-03T08:30:00.000Z", status: "answered", events: [] },
  ...over,
});
const base = { running: 48, backupAgo: "9 h" as string | null, error: false };

// --- gate (R1) ---
test("first paint shows every id", () => {
  const g = gate(null, ["a", "b"]);
  assert.deepEqual(g.shown, ["a", "b"]);
  assert.deepEqual(g.waiting, []);
  assert.deepEqual(g.fixed, []);
});
test("later new ids wait behind the pill", () => {
  const g = gate(["a", "b"], ["a", "b", "c"]);
  assert.deepEqual(g.shown, ["a", "b"]);
  assert.deepEqual(g.waiting, ["c"]);
});
test("a cleared id stays as a fixed slot", () => {
  const g = gate(["a", "b"], ["b"]);
  assert.deepEqual(g.shown, ["a", "b"]);
  assert.deepEqual(g.fixed, ["a"]);
});
test("reveal commits both: new in, fixed out", () => {
  assert.deepEqual(reveal(["b", "c"]), ["b", "c"]);
});
test("slotOrder keeps a fixed slot at its index and reorders the live ones around it", () => {
  assert.deepEqual(slotOrder(["a", "b", "c"], new Set(["a"]), ["c", "b"]), ["a", "c", "b"]);
});
test("pillText", () => {
  assert.equal(pillText(2, 0), "2 new · show");
  assert.equal(pillText(0, 1), "1 fixed · hide");
  assert.equal(pillText(1, 3), "1 new · show");
  assert.equal(pillText(0, 0), "");
});

// --- answerFor ---
test("loading, and a fetch error beats stale data", () => {
  assert.deepEqual(answerFor({ ...base, report: null }), { tone: "pending", text: "Checking the box…" });
  const a = answerFor({ ...base, report: report(), error: true });
  assert.equal(a.text, "Can't get an answer from the box right now");
  assert.equal(a.tone, "pending");
});
test("Docker failed: bad tone, counts the other rows", () => {
  const p = probes(...DOCKER.map((id) => failed(id, "ENOENT")));
  assert.deepEqual(answerFor({ ...base, report: report({ probes: p }) }), {
    tone: "bad",
    text: "Can't reach Docker, so app health is unknown",
  });
  const two = answerFor({ ...base, report: report({ probes: p, hits: [hit("disks", "disk:/mnt/media", "warn")] }) });
  assert.equal(two.text, "Can't reach Docker, so app health is unknown. 1 more thing needs you");
});
test("hits: worst severity and the headline lowercased", () => {
  const one = answerFor({ ...base, report: report({ hits: [hit("crashes", "container:radarr")] }) });
  assert.deepEqual(one, { tone: "bad", text: "1 thing needs you: the radarr app crashed" });
  const many = answerFor({
    ...base,
    report: report({ hits: [hit("crashes", "container:radarr"), hit("disks", "disk:/x", "warn")] }),
  });
  assert.equal(many.text, "2 things need you. First: the radarr app crashed");
  const warn = answerFor({ ...base, report: report({ hits: [hit("disks", "disk:/x", "warn", "Disk is full")] }) });
  assert.equal(warn.tone, "warn");
});
test("another probe failed, pending, quiet", () => {
  const f = answerFor({ ...base, report: report({ probes: probes(failed("smart")) }) });
  assert.deepEqual(f, { tone: "pending", text: "Nothing wrong found, but the smart check failed" });
  const f2 = answerFor({ ...base, report: report({ probes: probes(failed("smart"), failed("mounts")) }) });
  assert.equal(f2.text, "Nothing wrong found, but 2 checks failed");
  const p = answerFor({ ...base, report: report({ probes: probes(pending("orchestra")) }) });
  assert.deepEqual(p, { tone: "pending", text: "Nothing wrong so far, 1 check still out" });
  assert.deepEqual(answerFor({ ...base, report: report() }), {
    tone: "ok",
    text: "All clear. 48 apps running, backup ran 9 h ago",
  });
  assert.equal(answerFor({ ...base, backupAgo: null, report: report() }).text, "All clear. 48 apps running");
});
test("no input with a pending or failed probe says All clear or the ok tone", () => {
  for (const id of IDS)
    for (const s of [pending(id), failed(id)])
      for (const error of [false, true]) {
        const a = answerFor({ ...base, error, report: report({ probes: probes(s) }) });
        assert.ok(!a.text.startsWith("All clear"), `${id} ${s.state}`);
        assert.notEqual(a.tone, "ok", `${id} ${s.state}`);
      }
});

// --- probeLine / calmLine ---
test("probeLine", () => {
  assert.equal(probeLine(null, "08:30"), "Asking 8 sources…");
  assert.equal(probeLine(report(), "08:30"), "8 of 8 checks answered at 08:30");
  assert.equal(
    probeLine(report({ probes: probes(pending("orchestra")) }), "08:30"),
    "7 of 8 checks answered at 08:30 · waiting on orchestra",
  );
  assert.equal(
    probeLine(report({ probes: probes(failed("backup")) }), "08:30"),
    "7 of 8 checks answered at 08:30 · backup failed",
  );
});
test("calmLine", () => {
  assert.equal(calmLine(report(), 0, "08:30"), "Nothing. Every check answered at 08:30.");
  assert.equal(
    calmLine(report({ probes: probes(pending("orchestra")) }), 0, "08:30"),
    "Nothing so far. Still waiting on orchestra.",
  );
  assert.equal(calmLine(report(), 2, "08:30"), "Nothing listed yet. 2 new since 08:30.");
  assert.equal(calmLine(null, 0, "08:30"), "Unknown.");
});

// --- feedSlots (R2) ---
const ev = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));
test("feedSlots: S = 4 closed, S = total at tap when open, overflow count", () => {
  const closed = feedSlots(ev(7), false, 7);
  assert.equal(closed.S, 4);
  assert.deepEqual(closed.ids, ["e0", "e1", "e2", "e3"]);
  assert.equal(closed.overflow, 3);
  const open = feedSlots(ev(7), true, 7);
  assert.equal(open.S, 7);
  assert.equal(open.overflow, 0);
  const grew = feedSlots(ev(9), true, 7);
  assert.equal(grew.S, 7); // the box does not grow after the tap
  assert.equal(grew.overflow, 2);
  assert.equal(feedSlots(ev(2), false, 7).S, 4);
});
test("feedSlots through the ranker: held keeps the same slot ids", () => {
  const r = createRanker();
  r.offer(feedSlots(ev(3), false, 0).ids, 0, false);
  const before = r.order!.slice();
  const next = [{ id: "new" }, ...ev(3)];
  assert.equal(r.offer(feedSlots(next, false, 0).ids, 10_000, true), false);
  assert.deepEqual(r.order, before);
  assert.equal(r.offer(feedSlots(next, false, 0).ids, 10_000, false), true);
  assert.deepEqual(r.order, ["new", "e0", "e1", "e2"]);
});

// --- parseLastLooked (R6) ---
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const H = 3_600_000;
test("parseLastLooked: fallback for garbage, future, > 30 d, absent", () => {
  for (const raw of [null, undefined, "", "abc", "NaN", "-5", "0", String(NOW + H), String(NOW - 31 * 24 * H)]) {
    const p = parseLastLooked(raw, NOW);
    assert.equal(p.since, NOW - 24 * H, String(raw));
    assert.equal(p.label, "last 24 h");
  }
});
test("parseLastLooked: a valid value is kept", () => {
  assert.deepEqual(parseLastLooked(String(NOW - 8 * H), NOW), { since: NOW - 8 * H, label: null });
});

// --- homeRows ---
test("homeRows: 3 Docker failures make 1 bad row, first", () => {
  const p = probes(...DOCKER.map((id) => failed(id, "ENOENT /var/run")));
  const rows = homeRows(report({ probes: p, hits: [hit("disks", "disk:/x", "warn")] }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].headline, "Can't reach Docker");
  assert.equal(rows[0].severity, "bad");
  assert.deepEqual(rows[0].owner, { href: "/logs", label: "Open Logs" });
  assert.equal(rows[1].subject, "disk:/x");
});
test("homeRows: another failed probe is one warn row with the clipped error", () => {
  const rows = homeRows(report({ probes: probes(failed("smart", "x".repeat(200))) }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, "warn");
  assert.equal(rows[0].headline, "The smart check failed");
  assert.ok(rows[0].detail!.length <= 140);
  assert.equal(homeRows(report()).length, 0);
});
test("homeRows: since falls back to firstSeen", () => {
  const rows = homeRows(
    report({ hits: [{ ...hit("backup", "backup", "warn"), since: "2026-11-04T01:00:00.000Z" }, hit("disks", "disk:/x", "warn")] }),
  );
  assert.equal(rows[0].since, "2026-11-04T01:00:00.000Z");
  assert.equal(rows[1].since, "2026-11-04T08:00:00.000Z");
});

test("clock formats hh:mm in a given offset", () => {
  assert.equal(clock("2026-11-04T08:30:00.000Z", 0), "08:30");
  assert.equal(clock(Date.UTC(2026, 10, 4, 23, 5), 660), "10:05");
});

// --- fix round 1 ---
test("dropListed: an event for a listed subject (a resolved row too) is not repeated", () => {
  const events = [{ id: "e1", subjects: ["container:radarr"] }, { id: "e2", subjects: ["container:sonarr"] }, { id: "e3", subjects: [] }];
  assert.deepEqual(dropListed(events, new Set(["container:radarr"])).map((e) => e.id), ["e2", "e3"]);
  assert.equal(dropListed(events.slice(0, 1), new Set(["container:radarr"])).length, 0);
});
test("answerFor: a quiet report with the containers fetch failed says the app count is unknown", () => {
  const a = answerFor({ ...base, report: report(), containersFailed: true, running: null });
  assert.deepEqual(a, { tone: "ok", text: "All clear. App count unknown." });
  assert.equal(answerFor({ ...base, report: report() }).text, "All clear. 48 apps running, backup ran 9 h ago");
});
test("ageText", () => {
  assert.equal(ageText(20_000), "20 s");
  assert.equal(ageText(40 * 60_000), "40 min");
  assert.equal(ageText(9 * 3_600_000), "9 h");
  assert.equal(ageText(72 * 3_600_000), "3 d");
});

// --- fix round 2 ---
test("ranker fill: an empty box takes the next offer inside the gap, a full one still waits", () => {
  const r = createRanker();
  r.offer([], 0, false);
  assert.equal(r.offer(feedSlots(ev(6), false, 0).ids, 1_000, false, true), true);
  assert.equal(r.order!.length, 4);
  assert.equal(r.offer(["x", "e0", "e1", "e2"], 1_500, false, true), false);
  const held = createRanker();
  held.offer([], 0, false);
  assert.equal(held.offer(["a"], 1_000, false), false);
});
test("nightlyAt: a stale check gives no backup clause", () => {
  const ok = { status: "ok" as const, checkedAt: "2026-11-04T08:00:00.000Z", items: [{ kind: "backup" as const, state: "OK" as const, at: "2026-11-04T03:00:00.000Z" }] };
  assert.equal(nightlyAt(ok, Date.parse("2026-11-04T09:00:00.000Z")), "2026-11-04T03:00:00.000Z");
  assert.equal(nightlyAt(ok, Date.parse("2026-11-24T09:00:00.000Z")), null);
  assert.equal(nightlyAt({ status: "missing" }, 0), null);
  assert.equal(answerFor({ ...base, backupAgo: null, report: report() }).text, "All clear. 48 apps running");
});

test("diskLine labels each percent with the mount's short name", async () => {
  const { diskLine } = await import("./home.ts");
  const d = (mount: string, percent: number) => ({ mount, percent });
  assert.equal(diskLine([d("/", 40.6), d("/mnt/media", 68)]), "root\u00a041% · media\u00a068%");
  assert.equal(diskLine([d("/mnt/a-very-long-disk-name", 5)]), "a-very-long-…\u00a05%");
  assert.equal(diskLine([d("", 7)]), "7%");
  assert.equal(diskLine([d("/", 41)]), "root\u00a041%");
});
