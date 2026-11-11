import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { doorLinkDecision, hasDoorParam, withoutDoorParam } from "./kiosk-door-link.ts";

test("only door=1 exactly counts", () => {
  assert.equal(hasDoorParam("?door=1"), true);
  assert.equal(hasDoorParam("?layout=glance&door=1&wx=overcast"), true);
  for (const s of ["", "?door=", "?door=0", "?door=true", "?door=11", "?door=1&door=2", "?doors=1", "?DOOR=1"]) {
    assert.equal(hasDoorParam(s), false, s);
  }
});

test("decision: wait for the camera list, ignore with no camera or no param, else open", () => {
  assert.equal(doorLinkDecision("?door=1", false, false), "wait");
  assert.equal(doorLinkDecision("?door=1", true, false), "ignore");
  assert.equal(doorLinkDecision("?layout=glance", true, true), "ignore");
  assert.equal(doorLinkDecision("?door=2", true, true), "ignore");
  assert.equal(doorLinkDecision("?door=1", true, true), "open");
});

test("withoutDoorParam drops door and keeps every other param", () => {
  assert.equal(withoutDoorParam("/kiosk", "?door=1", "#x"), "/kiosk#x");
  assert.equal(
    withoutDoorParam("/kiosk", "?layout=standard&door=1&theme=sunroom&wx=overcast&wxsun=day", ""),
    "/kiosk?layout=standard&theme=sunroom&wx=overcast&wxsun=day",
  );
});

test("page wires the deep link once, through the manual open and the night wake", () => {
  const page = readFileSync(fileURLToPath(new URL("../app/kiosk/page.tsx", import.meta.url)), "utf8");
  assert.match(page, /^\s+const decision = doorLinkDecision\(/m);
  assert.match(page, /^\s+wakeNight\(\);\s*\n\s+openDoorManually\(\);\s*$/m);
  assert.match(page, /^\s+if \(hasDoorParam\(search\)\) window\.history\.replaceState\(/m);
  assert.match(page, /^\s+doorLinkDoneRef\.current = true;\s*$/m);
});
