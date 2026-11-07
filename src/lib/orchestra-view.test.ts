import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentLook,
  agentRowId,
  bandView,
  checkpointView,
  formatQuiet,
  holdMembers,
  holdPillText,
  homeLanesText,
  inFlightRows,
  isLive,
  laneAttention,
  laneBadge,
  laneRowId,
  laneSentence,
  laneStuck,
  laneTally,
  loadErrorCopy,
  orchestraAttention,
  pageFreshness,
  pageKind,
  partialBand,
  slotLayout,
  stallFill,
  tallySegments,
} from "./orchestra-view.ts";
import type { OrchestratorInFlight, OrchestratorSummary } from "./types/orchestra.ts";

const o = (state: OrchestratorSummary["state"], stalledCount = 0, inFlight: OrchestratorInFlight[] = [], name = "dev"): OrchestratorSummary => ({
  name, title: null, state, lastActivityAt: null, model: null, home: null, inFlightCount: inFlight.length, stalledCount, watcher: null, inFlight,
});
const ag = (name: string, quietMin: number | null, waiting: OrchestratorInFlight["waiting"] = null): OrchestratorInFlight => ({ name, quietMin, waiting });
const wait = (tool: string, sinceMin: number) => ({ tool, sinceMin });

describe("pageKind", () => {
  it("loading only while there is no data and no error", () => {
    assert.equal(pageKind({ isLoading: true, hasData: false, hasError: false }), "loading");
    assert.equal(pageKind({ isLoading: false, hasData: false, hasError: true }), "load-error");
    assert.equal(pageKind({ isLoading: false, hasData: true, hasError: true, status: "unconfigured" }), "unconfigured");
    assert.equal(pageKind({ isLoading: false, hasData: true, hasError: false, status: "ok" }), "band");
  });
});

describe("pageFreshness (B1)", () => {
  it("a failed poll with a snapshot from earlier is stale and drops the connected dot", () => {
    assert.deepEqual(pageFreshness({ status: "ok", hasError: true, hasLastOk: true }), { stale: true, connected: false });
  });
  it("a good poll is connected and fresh", () => {
    assert.deepEqual(pageFreshness({ status: "ok", hasError: false, hasLastOk: true }), { stale: false, connected: true });
  });
  it("unreachable keeps today's behaviour: stale only with a last good snapshot", () => {
    assert.deepEqual(pageFreshness({ status: "unreachable", hasError: false, hasLastOk: true }), { stale: true, connected: false });
    assert.deepEqual(pageFreshness({ status: "unreachable", hasError: false, hasLastOk: false }), { stale: false, connected: false });
  });
  it("an error with nothing good to show is not stale", () => {
    assert.deepEqual(pageFreshness({ status: undefined, hasError: true, hasLastOk: false }), { stale: false, connected: false });
  });
});

describe("loadErrorCopy", () => {
  it("403 asks for a full sign-in, anything else names the own route", () => {
    assert.equal(loadErrorCopy(403), "This page needs a full sign-in. The kiosk PIN does not open it.");
    assert.equal(loadErrorCopy(500), "Could not reach nightwatch's own /api/orchestra.");
    assert.equal(loadErrorCopy(undefined), "Could not reach nightwatch's own /api/orchestra.");
  });
});

describe("agentLook and stallFill (C8)", () => {
  it("the boundaries 19 / 20 / 360 / 361 / null", () => {
    assert.deepEqual([agentLook(ag("a", 19)), stallFill(19)], ["quiet", 0.95]);
    assert.deepEqual([agentLook(ag("a", 20)), stallFill(20)], ["stalled", 1]);
    assert.equal(agentLook(ag("a", 360)), "stalled");
    assert.equal(agentLook(ag("a", 361)), "quiet");
    assert.equal(stallFill(361), 1);
    assert.deepEqual([agentLook(ag("a", null)), stallFill(null)], ["quiet", 0]);
  });
  it("a waiting agent is waiting whatever its quiet time (OPEN-O1)", () => {
    assert.equal(agentLook(ag("a", 2, wait("Bash", 7))), "waiting");
    assert.equal(agentLook(ag("a", null, wait("Bash", 7))), "waiting");
    assert.equal(agentLook(ag("a", 30, wait("Bash", 7))), "waiting");
  });
});

describe("laneTally (R3, OPEN-O1)", () => {
  const list = [
    o("running", 0, [ag("a", 2), ag("b", 5)], "one"),
    o("running", 0, [ag("c", 1, wait("Bash", 6))], "two"),
    o("stalled", 1, [ag("d", 25)], "three"),
    o("stopped", 0, [], "four"),
    o("unknown", 0, [], "five"),
  ];
  it("a lane is stuck on a waiting agent (even under 20 m) or a stalled one; unknown is not stopped", () => {
    assert.deepEqual(list.map(laneStuck), [false, true, true, false, false]);
    assert.deepEqual(laneTally(list), { stuck: 2, running: 1, stopped: 1, unknown: 1, agents: 4 });
  });
  it("segments follow Home's order and leave out zeros", () => {
    assert.deepEqual(tallySegments(laneTally(list)).map((s) => `${s.n} ${s.label}`), ["2 stuck", "1 running", "1 stopped", "1 not read", "4 agents in flight"]);
    assert.deepEqual(tallySegments(laneTally([o("running", 0, [ag("a", 1)])])).map((s) => `${s.n} ${s.label}`), ["1 running", "1 agent in flight"]);
    assert.deepEqual(tallySegments(laneTally([])), []);
  });
});

describe("laneSentence (R3, C14)", () => {
  it("all quiet", () => {
    assert.equal(laneSentence([o("running", 0, [ag("a", 1), ag("b", 2)]), o("running", 0, [ag("c", 3)], "x")], { stale: false }), "Nothing needs you. 2 lanes running, 3 agents in flight.");
    assert.equal(laneSentence([o("running", 0, [ag("a", 1)])], { stale: false }), "Nothing needs you. 1 lane running, 1 agent in flight.");
  });
  it("one waiting, one stalled, several", () => {
    assert.equal(
      laneSentence([o("running", 0, [ag("design-shape", 1, wait("Bash", 7))], "design")], { stale: false }),
      "design needs you: design-shape has a Bash call waiting 7m, usually a permission prompt.",
    );
    assert.equal(laneSentence([o("stalled", 1, [ag("dev-reviewer", 24)])], { stale: false }), "dev needs you: dev-reviewer has been quiet 24m.");
    assert.equal(
      laneSentence([o("stalled", 1, [ag("a", 24)], "dev"), o("running", 0, [ag("b", 1, wait("Edit", 6))], "design")], { stale: false }),
      "2 lanes need you: dev and design.",
    );
  });
  it("a stuck lane with two agents needing a look says how many", () => {
    assert.equal(laneSentence([o("stalled", 2, [ag("a", 24), ag("b", 30)])], { stale: false }), "dev needs you: 2 agents need a look.");
  });
  it("never says Nothing needs you when partial or stale, and is empty when stale or no lanes are known", () => {
    const partial = laneSentence([o("running", 0, [ag("a", 1)]), o("unknown", 0, [], "u")], { stale: false });
    assert.ok(partial && !/Nothing needs you/.test(partial));
    assert.equal(partial, "1 lane running, 1 agent in flight. 1 could not be read.");
    assert.equal(laneSentence([o("running")], { stale: true }), null);
    assert.equal(laneSentence([], { stale: false }), "No lanes registered.");
  });
});

describe("laneAttention (R3, R7)", () => {
  it("waiting: the fix line, the agent in ink", () => {
    const a = laneAttention(o("running", 0, [ag("design-shape", 1, wait("Bash", 7))]), false);
    assert.deepEqual(a, { text: "design-shape · Bash call waiting 7m, usually a permission prompt. Answer it on the PC.", who: "design-shape", tone: "ink" });
  });
  it("stalled, several, stopped, unknown, quiet, stale", () => {
    assert.equal(laneAttention(o("stalled", 1, [ag("r", 24)]), false).text, "r has been quiet 24m. Check its session on the PC.");
    assert.equal(laneAttention(o("stalled", 2, [ag("r", 24), ag("s", 30)]), false).text, "2 agents need you: s, r.");
    assert.equal(laneAttention(o("stopped"), false).text, "Stopped. Start it from the PC.");
    assert.equal(laneAttention(o("unknown"), false).text, "Orchestra could not read this lane.");
    assert.deepEqual(laneAttention(o("running", 0, [ag("a", 3)]), false), { text: "", who: null, tone: "dim" });
    assert.equal(laneAttention(o("stalled", 1, [ag("r", 24)]), true).tone, "dim");
  });
  it("none of the copy promises a write", () => {
    for (const l of [o("stopped"), o("unknown"), o("stalled", 1, [ag("r", 24)]), o("running", 0, [ag("a", 1, wait("Bash", 6))])]) {
      assert.ok(!/\b(restart|start opens|click)\b/i.test(laneAttention(l, false).text.replace("Start it from the PC", "")), l.state);
    }
  });
});

describe("laneBadge", () => {
  it("running ok; stuck warn with the mark; stopped and not read neutral", () => {
    assert.deepEqual(laneBadge(o("running"), false), { text: "running", tone: "ok", mark: false, dot: "dot-running" });
    assert.deepEqual(laneBadge(o("running", 0, [ag("a", 1, wait("Bash", 6))]), false), { text: "stuck", tone: "warn", mark: true, dot: "dot-unhealthy" });
    assert.deepEqual(laneBadge(o("stalled", 1), false), { text: "stuck", tone: "warn", mark: true, dot: "dot-unhealthy" });
    assert.deepEqual(laneBadge(o("stopped"), false), { text: "stopped", tone: "neutral", mark: false, dot: "dot-stopped" });
    assert.deepEqual(laneBadge(o("unknown"), false), { text: "not read", tone: "neutral", mark: false, dot: "dot-stopped" });
  });
  it("stale prefixes was, goes neutral and carries no mark", () => {
    assert.deepEqual(laneBadge(o("stalled", 1), true), { text: "was stuck", tone: "neutral", mark: false, dot: "dot-stopped" });
  });
});

describe("partialBand", () => {
  it("names how many lanes could not be read, only when some could not", () => {
    assert.equal(partialBand([o("running"), o("unknown"), o("unknown")]), "2 of 3 lanes could not be read. They show as unknown, not stopped.");
    assert.equal(partialBand([o("running")]), null);
  });
});

describe("holdMembers and the slots (R8, C9)", () => {
  it("ids stay constant over 6 ticks while the pill counts joins and leaves", () => {
    const held = ["a", "b", "c"];
    for (let tick = 0; tick < 6; tick++) {
      const m = holdMembers(held, tick < 3 ? ["a", "b", "c"] : ["a", "c", "d"]);
      assert.deepEqual(m.shown, held);
      assert.deepEqual([m.fresh, m.left], tick < 3 ? [0, 0] : [1, 1]);
    }
  });
  it("pill copy: joins say N new, only leaves say Update list", () => {
    assert.equal(holdPillText({ fresh: 1, left: 0 }), "1 new · show");
    assert.equal(holdPillText({ fresh: 2, left: 3 }), "2 new · show");
    assert.equal(holdPillText({ fresh: 0, left: 1 }), "Update list");
  });
  it("four slots always: free ones fill, a fifth agent turns slot 4 into Show more", () => {
    const kinds = (names: string[]) => slotLayout("dev", names).map((s) => s.kind);
    assert.deepEqual(kinds(["a"]), ["agent", "free", "free", "free"]);
    assert.deepEqual(kinds(["a", "b", "c", "d"]), ["agent", "agent", "agent", "agent"]);
    const six = slotLayout("dev", ["a", "b", "c", "d", "e", "f"]);
    assert.deepEqual(six.map((s) => s.kind), ["agent", "agent", "agent", "more"]);
    assert.equal(six[3].kind === "more" && six[3].n, 3);
  });
  it("a held-out join that is waiting still reaches the lane's words (live data, not the held set)", () => {
    const lane = o("running", 0, [ag("a", 1), ag("new", 1, wait("Bash", 8))]);
    assert.equal(holdMembers(["a"], lane.inFlight.map((x) => x.name)).fresh, 1);
    assert.match(laneAttention(lane, false).text, /^new · Bash call waiting 8m/);
    assert.match(laneSentence([lane], { stale: false }) ?? "", /^dev needs you: new has a Bash call waiting 8m/);
  });
});

describe("row ids (C13)", () => {
  it("lane, agent, more and free ids are unique over a busy board", () => {
    const lanes = [o("running", 0, ["a", "b", "c", "d", "e", "f"].map((n) => ag(n, 1)), "dev"), o("running", 0, [ag("a", 1)], "odip"), o("stopped", 0, [], "design")];
    const ids = lanes.flatMap((l) => [laneRowId(l.name), ...slotLayout(l.name, l.inFlight.map((a) => a.name)).map((s) => s.id)]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(agentRowId("dev", "a"), "dev/a");
  });
});

describe("bandView", () => {
  it("unauthorized", () => {
    const b = bandView("unauthorized", { detail: "x" });
    assert.deepEqual([b.dot, b.label, b.tone, b.sentence], ["dot-unhealthy", "unauthorized", "warn", "Orchestra rejected the token."]);
  });
  it("unreachable with no last-known shows the service detail and the retry hint", () => {
    const b = bandView("unreachable", { detail: "no answer" });
    assert.equal(b.stale, false);
    assert.equal(b.sentence, "Orchestra is not answering.");
    assert.equal(b.hint, "The PC is probably off or asleep. This page checks again every 10 seconds.");
    assert.equal(b.detail, "no answer");
  });
  it("unreachable with last-known is stale and quotes the age, without the detail line", () => {
    const b = bandView("unreachable", { detail: "no answer", lastAge: "4m ago" });
    assert.equal(b.stale, true);
    assert.equal(b.hint, "The PC is probably off or asleep. Showing what it last reported, 4m ago.");
    assert.equal(b.detail, null);
    assert.equal(b.dot, "dot-dead");
  });
});

describe("checkpointView", () => {
  it("null has its own copy", () => {
    assert.deepEqual(checkpointView(null), { text: "No checkpoint recorded.", cut: false, empty: true });
  });
  it("over 300 chars is cut to 300 plus an ellipsis, exactly 300 gets the ellipsis and note too", () => {
    const long = checkpointView("a".repeat(500));
    assert.equal(long.text, "a".repeat(300) + "…");
    assert.equal(long.cut, true);
    assert.equal(checkpointView("b".repeat(300)).text, "b".repeat(300) + "…");
    assert.deepEqual(checkpointView("short"), { text: "short", cut: false, empty: false });
  });
});

describe("in-flight rows", () => {
  it("stalled (>=20 and <=360 quiet minutes) first, then quietest, nulls last", () => {
    const rows = inFlightRows([
      ag("c", null), ag("b", 3), ag("a", 25), ag("d", 12), ag("z", 400),
    ]);
    assert.deepEqual(rows.map((r) => [r.name, r.stalled]), [["a", true], ["z", false], ["d", false], ["b", false], ["c", false]]);
  });
  it("formats quiet minutes", () => {
    assert.equal(formatQuiet(12), "quiet 12m");
    assert.equal(formatQuiet(125), "quiet 2h 5m");
    assert.equal(formatQuiet(null), "no transcript yet");
  });
});

describe("isLive", () => {
  it("counts an entry with a transcript up to STALL_MAX; a dead marker or no transcript is not live", () => {
    assert.equal(isLive(0), true);
    assert.equal(isLive(360), true);
    assert.equal(isLive(361), false);
    assert.equal(isLive(null), false);
  });
});

describe("orchestraAttention", () => {
  const d = (name: string, quiet: (number | null)[], title: string | null = null) => ({
    name, title, inFlight: quiet.map((q, i) => ({ name: `agent-${name}-${i}`, quietMin: q, waiting: null })),
  });

  it("says nothing when orchestra is not configured, even with stalled agents", () => {
    assert.equal(orchestraAttention("unconfigured", [d("dev", [42])]), null);
  });

  it("says nothing when every in-flight agent is fine", () => {
    assert.equal(orchestraAttention("ok", [d("dev", [5, null]), d("odip", [])]), null);
  });

  it("names the orchestrator, the agent and the quiet time for one stalled agent", () => {
    assert.deepEqual(orchestraAttention("ok", [d("dev", [3]), d("odip", [42], "ODIP")]), {
      headline: "agent-odip-0 has gone quiet",
      detail: "In ODIP, quiet 42m. It may be stuck.",
      action: "Check it on the AI lanes page.",
    });
  });

  it("counts several stalled agents and names the longest", () => {
    assert.deepEqual(orchestraAttention("ok", [d("dev", [25]), d("odip", [5, 125])]), {
      headline: "2 agents have gone quiet",
      detail: "Longest: agent-odip-1 in odip, quiet 2h 5m. They may be stuck.",
      action: "Check them on the AI lanes page.",
    });
  });

  it("stays quiet when unreachable and the last good reading had nothing in flight", () => {
    assert.equal(orchestraAttention("unreachable", [], 0), null);
  });

  it("stays quiet when unreachable with no good reading since the server started", () => {
    assert.equal(orchestraAttention("unreachable", []), null);
  });

  it("flags a service that stopped answering while agents were running", () => {
    assert.deepEqual(orchestraAttention("unreachable", [], 2), {
      headline: "The PC's agent service stopped answering",
      detail: "2 agents were running. The PC may be off or asleep.",
      action: "Wake the PC, or ignore this if you turned it off.",
    });
    assert.equal(orchestraAttention("unreachable", [], 1)?.detail, "1 agent was running. The PC may be off or asleep.");
  });

  it("flags a rejected token", () => {
    assert.deepEqual(orchestraAttention("unauthorized", [], 0), {
      headline: "The PC's agent service refused the key",
      detail: "nightwatch's saved access token is wrong or out of date, so agents can't be checked.",
      action: "Replace the token in Settings, under Access.",
    });
  });

  it("follows isStalled at STALL_MAX: 360 min speaks, 361 is a dead marker", () => {
    assert.equal(orchestraAttention("ok", [d("dev", [360])])?.headline, "agent-dev-0 has gone quiet");
    assert.equal(orchestraAttention("ok", [d("dev", [361])]), null);
  });

  it("follows isStalled at STALL_MIN: 19 min is still fine, 20 speaks", () => {
    assert.equal(orchestraAttention("ok", [d("dev", [19])]), null);
    assert.equal(orchestraAttention("ok", [d("dev", [20])])?.headline, "agent-dev-0 has gone quiet");
  });
});

describe("waiting agents on Home (O2)", () => {
  const w = (name: string, tool: string, sinceMin: number, title: string | null = null) => ({
    name: `lane-${name}`, title, inFlight: [{ name: `agent-${name}`, quietMin: 1, waiting: { tool, sinceMin } }],
  });
  const stalled = { name: "odip", title: null, inFlight: [{ name: "agent-odip", quietMin: 90, waiting: null }] };

  it("raises an item for a waiting agent, with the lanes page's wording", () => {
    assert.deepEqual(orchestraAttention("ok", [w("dev", "Bash", 6, "Dev")]), {
      headline: "Dev is waiting for you",
      detail: "agent-dev has a Bash call waiting 6m, usually a permission prompt.",
      action: "Answer it on the PC.",
    });
  });
  it("ranks a waiting agent above a stalled one", () => {
    assert.equal(orchestraAttention("ok", [stalled, w("dev", "Bash", 2)])?.headline, "lane-dev is waiting for you");
  });
  it("counts several waiting agents and names the longest", () => {
    const r = orchestraAttention("ok", [w("a", "Bash", 2), w("b", "Edit", 9)]);
    assert.equal(r?.headline, "2 agents are waiting for you");
    assert.equal(r?.detail, "Longest: agent-b has a Edit call waiting 9m, usually a permission prompt.");
  });
  it("Home's lane text counts a lane with a waiting agent as stuck, and leaves out the agent count", () => {
    const list = [o("running", 0, [ag("a", 1, wait("Bash", 3))], "one"), o("running", 0, [ag("b", 1)], "two"), o("stopped", 0, [], "three")];
    assert.equal(homeLanesText(list), "1 stuck, 1 running, 1 stopped");
    assert.equal(homeLanesText([o("running", 0, [ag("a", 1, wait("Bash", 3))])]), "1 stuck");
    assert.equal(homeLanesText([]), "no lanes");
  });
});
