import test from "node:test";
import assert from "node:assert/strict";
import { connectionHead, type ConnectionState } from "./integration-head.ts";

const cfg = { name: "Hermes", place: "Settings → Access", href: "/settings#access", paused: "Status, runs and ask", retryS: 10 };
const head = (s: ConnectionState) => connectionHead(cfg, s);

test("loading", () => {
  const h = head("loading");
  assert.deepEqual(h.chip, { tone: "neutral", label: "Checking" });
  assert.equal(h.answer, "Connecting to Hermes…");
  assert.equal(h.evidence, "First answer usually takes a second");
  assert.equal(h.link, null);
});

test("load error", () => {
  const h = head("error");
  assert.deepEqual(h.chip, { tone: "warn", label: "No answer" });
  assert.equal(h.answer, "The dashboard can’t reach its own Hermes check, so Hermes’s state is unknown.");
  assert.equal(h.evidence, "Check that the dashboard is running, then reload.");
  assert.equal(h.link, null);
});

test("unconfigured", () => {
  const h = head("unconfigured");
  assert.deepEqual(h.chip, { tone: "neutral", label: "Not connected" });
  assert.equal(h.answer, "Hermes isn’t connected yet.");
  assert.equal(h.evidence, "Add the Hermes address and token in Settings → Access.");
  assert.deepEqual(h.link, { href: "/settings#access", label: "Open Settings" });
});

test("unauthorized", () => {
  const h = head("unauthorized");
  assert.deepEqual(h.chip, { tone: "warn", label: "Token rejected" });
  assert.equal(h.answer, "Hermes rejected the token. Check it in Settings → Access.");
  assert.equal(h.evidence, "Everything here is paused until the token works.");
  assert.deepEqual(h.link, { href: "/settings#access", label: "Open Settings" });
});

test("unreachable", () => {
  const h = head("unreachable");
  assert.deepEqual(h.chip, { tone: "warn", label: "Not answering" });
  assert.equal(h.answer, "Hermes isn’t answering. Status, runs and ask are paused until it’s back.");
  assert.equal(h.evidence, "Retrying every 10 s.");
  assert.equal(h.link, null);
});

test("every state keeps the strips as they are, and never reads an upstream detail", () => {
  for (const s of ["loading", "error", "unconfigured", "unauthorized", "unreachable"] as const) assert.equal(head(s).autoTarget, "keep");
  assert.equal(connectionHead.length, 2);
});
