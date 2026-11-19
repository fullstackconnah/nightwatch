import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const page = () => read("../app/(dash)/networks/page.tsx");

test("bridge rows tell loading, failed and ready docker reads apart", () => {
  const src = page();
  assert.match(src, /const \{ data: dockerNets, error: dockerError \} = useSWR</);
  assert.match(src, /dockerNets \? "ready" : dockerError \? "failed" : "loading"/);
  assert.ok(src.includes("docker details unavailable"));
  assert.ok(src.includes("reading docker networks…"));
});

test("container footprint says why it has no rows", () => {
  const src = page();
  assert.match(src, /const \{ data, error \} = useContainers\(15000\)/);
  assert.ok(src.includes("Could not read the container list, so traffic cannot be split by container."));
  assert.ok(src.includes("Reading containers…"));
});

test("both lists sort by the window total, not the latest tick", () => {
  const src = page();
  const bridges = src.slice(src.indexOf("const sortedBridges"), src.indexOf("const virtualTotals"));
  assert.ok(bridges.length > 50);
  assert.doesNotMatch(bridges, /latestRate\(/);
  assert.match(bridges, /seriesTotal\(/);
  assert.match(bridges, /localeCompare/);
  const foot = src.slice(src.indexOf("return [...groups.values()]"), src.indexOf("const total = rows.reduce"));
  assert.match(foot, /windowTotal/);
  assert.match(foot, /localeCompare/);
  assert.doesNotMatch(foot, /b\.rx \+ b\.tx - \(a\.rx \+ a\.tx\)/);
  assert.match(read("../components/resources/net-throughput.tsx"), /export function seriesTotal\(/);
});

test("owner maps are read in parallel with the other snapshot reads", () => {
  const src = read("./network.ts");
  const all = src.slice(src.indexOf("await Promise.all(["), src.indexOf("const ctx: BuildContext"));
  assert.ok(all.includes("readDockerNetInfo(warnings)"));
  assert.ok(all.includes("readOwnerMaps(warnings)"));
  assert.doesNotMatch(src, /await readOwnerMaps\(/);
});
