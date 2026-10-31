import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandView,
  cardBadge,
  checkpointView,
  formatQuiet,
  inFlightRows,
  loadErrorCopy,
  okSentence,
  pageKind,
} from "./orchestra-view.ts";
import type { OrchestratorSummary } from "./types/orchestra.ts";

const o = (state: OrchestratorSummary["state"], stalledCount = 0): OrchestratorSummary => ({
  name: "dev", title: null, state, lastActivityAt: null, model: null, home: null, inFlightCount: 0, stalledCount, watcher: null,
});

describe("pageKind", () => {
  it("loading only while there is no data and no error", () => {
    assert.equal(pageKind({ isLoading: true, hasData: false, hasError: false }), "loading");
    assert.equal(pageKind({ isLoading: false, hasData: false, hasError: true }), "load-error");
    assert.equal(pageKind({ isLoading: false, hasData: true, hasError: true, status: "unconfigured" }), "unconfigured");
    assert.equal(pageKind({ isLoading: false, hasData: true, hasError: false, status: "ok" }), "band");
  });
});

describe("loadErrorCopy", () => {
  it("403 asks for a full sign-in, anything else names the own route", () => {
    assert.equal(loadErrorCopy(403), "This page needs a full sign-in. The kiosk PIN does not open it.");
    assert.equal(loadErrorCopy(500), "Could not reach nightwatch's own /api/orchestra.");
    assert.equal(loadErrorCopy(undefined), "Could not reach nightwatch's own /api/orchestra.");
  });
});

describe("okSentence", () => {
  it("counts running and appends stalled only when above zero", () => {
    const s = okSentence([o("running"), o("stopped"), o("stalled", 2), o("unknown")]);
    assert.equal(`${s.head}${s.stalled ? `, ${s.stalled}` : ""}${s.tail}`, "Connected. 4 orchestrators, 1 running, 2 stalled.");
    const one = okSentence([o("running")]);
    assert.equal(`${one.head}${one.tail}`, "Connected. 1 orchestrator, 1 running.");
    assert.equal(one.stalled, null);
  });
  it("empty registry", () => {
    const s = okSentence([]);
    assert.equal(`${s.head}${s.tail}`, "Connected. No orchestrators registered.");
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

describe("cardBadge", () => {
  it("maps each state to a variant and dot", () => {
    assert.deepEqual(cardBadge("running", false), { variant: "ok", text: "running", dot: "dot-running" });
    assert.deepEqual(cardBadge("stalled", false), { variant: "warn", text: "stalled", dot: "dot-unhealthy" });
    assert.deepEqual(cardBadge("stopped", false), { variant: "neutral", text: "stopped", dot: "dot-stopped" });
    assert.deepEqual(cardBadge("unknown", false), { variant: "neutral", text: "unknown", dot: "dot-stopped" });
  });
  it("stale mode prefixes was and goes neutral", () => {
    assert.deepEqual(cardBadge("stalled", true), { variant: "neutral", text: "was stalled", dot: "dot-stopped" });
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
      { name: "c", quietMin: null }, { name: "b", quietMin: 3 }, { name: "a", quietMin: 25 }, { name: "d", quietMin: 12 }, { name: "z", quietMin: 400 },
    ]);
    assert.deepEqual(rows.map((r) => [r.name, r.stalled]), [["a", true], ["z", false], ["d", false], ["b", false], ["c", false]]);
  });
  it("formats quiet minutes", () => {
    assert.equal(formatQuiet(12), "quiet 12m");
    assert.equal(formatQuiet(125), "quiet 2h 5m");
    assert.equal(formatQuiet(null), "no transcript yet");
  });
});
