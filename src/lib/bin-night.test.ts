import test from "node:test";
import assert from "node:assert/strict";
import { binLine, binLineSegments, binsPayload, checkBins, mergeBins, nextBinNight, nightLabel, type BinsConfig } from "./bin-night.ts";
import type { AppConfig } from "./config.ts";

// invisible characters are built, never typed, so the source holds no hidden text
const ZWSP = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);
const BOM = String.fromCharCode(0xfeff);
const BEL = String.fromCharCode(7);
const TUE = 2;
const WED = 3;
const weekly = (name: string, weekday = TUE) => ({ name, weekday, every: 1 as const });
const fortnightly = (name: string, anchor: string, weekday = TUE) => ({ name, weekday, every: 2 as const, anchor });
const cfg = (...collections: BinsConfig["collections"]): BinsConfig => ({ collections });
const errorsOf = (input: unknown) => {
  const c = checkBins(input);
  if (c.ok) throw new Error("expected a refusal");
  return c.errors;
};

// ---- binLine: the design's copy table, verbatim ----
test("binLine: the sentence for one to four bins", () => {
  assert.equal(binLine(["Recycling"]), "Recycling goes out tonight");
  assert.equal(binLine(["X".repeat(20)]), `${"X".repeat(20)} goes out tonight`);
  assert.equal(binLine(["Recycling", "Rubbish"]), "Recycling and Rubbish go out tonight");
  assert.equal(binLine(["General waste", "Recycling"]), "General waste and Recycling go out tonight");
  assert.equal(binLine(["Recycling", "Garden", "Rubbish"]), "Recycling, Garden and Rubbish go out tonight");
  assert.equal(binLine(["Recycling", "Garden", "Rubbish"]).length, 44);
});

test("binLine: over 44 characters falls back to the short form", () => {
  assert.equal(binLine(["Garden organics", "General waste"]), "Garden organics and General waste tonight");
  assert.equal(binLine(["Recycling", "Garden", "General waste"]), "Recycling, Garden and General waste tonight");
  assert.equal(binLine(["Glass", "Paper", "Food", "Rubbish"]), "Glass, Paper, Food and Rubbish tonight");
});

test("binLine: the first letter is upper-cased, the names are otherwise verbatim", () => {
  assert.equal(binLine(["recycling", "gLASS"]), "Recycling and gLASS go out tonight");
});

test("binLineSegments: names are flagged, the rest is not, and the text equals binLine", () => {
  const segs = binLineSegments(["Recycling", "Garden", "Rubbish"]);
  assert.deepEqual(segs.filter((s) => s.name).map((s) => s.text), ["Recycling", "Garden", "Rubbish"]);
  assert.equal(segs.filter((s) => !s.name).map((s) => s.text).join("|"), ", | and | go out tonight");
});

// ---- nextBinNight: the decisive cases ----
test("nextBinNight: a weekly Tuesday is due the evening before", () => {
  assert.deepEqual(nextBinNight(cfg(weekly("Recycling")), "2026-11-16"), { date: "2026-11-16", bins: ["Recycling"] });
  // Tuesday itself: the truck has been, so the next evening is a week away
  assert.deepEqual(nextBinNight(cfg(weekly("Recycling")), "2026-11-17"), { date: "2026-11-23", bins: ["Recycling"] });
});

test("nextBinNight: a fortnightly Tuesday skips the off week", () => {
  const c = cfg(fortnightly("Garden", "2026-11-03"));
  assert.equal(nextBinNight(c, "2026-11-09")?.date, "2026-11-16");
  assert.equal(nextBinNight(c, "2026-11-16")?.date, "2026-11-16");
});

test("nextBinNight: a future anchor gives the same answers (parity works backwards)", () => {
  const past = cfg(fortnightly("Garden", "2026-11-03"));
  const future = cfg(fortnightly("Garden", "2027-01-12"));
  for (const today of ["2026-11-09", "2026-11-16", "2026-11-23", "2026-12-01"]) assert.deepEqual(nextBinNight(future, today), nextBinNight(past, today));
  assert.equal(nextBinNight(future, "2026-11-09")?.date, "2026-11-16");
});

test("nextBinNight: weekly plus fortnightly on one day come in card order; the off week has the weekly alone", () => {
  const c = cfg(weekly("Recycling"), fortnightly("Garden", "2026-11-03"));
  assert.deepEqual(nextBinNight(c, "2026-11-16"), { date: "2026-11-16", bins: ["Recycling", "Garden"] });
  assert.deepEqual(nextBinNight(c, "2026-11-09"), { date: "2026-11-09", bins: ["Recycling"] });
  const flipped = cfg(fortnightly("Garden", "2026-11-03"), weekly("Recycling"));
  assert.deepEqual(nextBinNight(flipped, "2026-11-16")?.bins, ["Garden", "Recycling"]);
});

test("nextBinNight: year boundary and the DST start", () => {
  assert.deepEqual(nextBinNight(cfg(weekly("Recycling", 5)), "2026-12-30"), { date: "2026-12-31", bins: ["Recycling"] });
  assert.equal(nextBinNight(cfg(weekly("Recycling", 1)), "2026-10-03")?.date, "2026-10-04");
});

test("nextBinNight: the first evening wins when two bins fall on different days", () => {
  const c = cfg(weekly("Late", 5), weekly("Early", 3));
  assert.deepEqual(nextBinNight(c, "2026-11-16"), { date: "2026-11-17", bins: ["Early"] });
});

test("nightLabel: weekday, day and month of the evening", () => {
  assert.equal(nightLabel("2026-11-17"), "Tuesday 17 Nov");
});

// ---- checkBins ----
test("checkBins: a clean rule comes back cleaned, with unknown fields dropped and a weekly anchor dropped", () => {
  const c = checkBins({
    collections: [
      { name: `  Re${ZWSP}cy${BEL}cling ${String.fromCharCode(9)} bin `, weekday: TUE, every: 1, anchor: "not a date", colour: "blue" },
      { name: "Garden", weekday: TUE, every: 2, anchor: "2026-11-03", extra: 1 },
    ],
    other: true,
  });
  assert.deepEqual(c, { ok: true, value: { collections: [{ name: "Recycling bin", weekday: TUE, every: 1 }, { name: "Garden", weekday: TUE, every: 2, anchor: "2026-11-03" }] } });
});

test("checkBins: a date on the wrong weekday gives the exact copy", () => {
  assert.deepEqual(errorsOf({ collections: [fortnightly("Garden", "2026-11-18", TUE)] }), [
    { row: 0, field: "anchor", message: "18 Nov 2026 is a Wednesday. Pick a Tuesday, or change the collection day." },
  ]);
});

test("checkBins: a 47-character night is refused with the card-level copy, naming the evening", () => {
  const names = ["Garden organics", "General waste", "Cans"];
  assert.equal(`${names[0]}, ${names[1]} and ${names[2]} tonight`.length, 47);
  assert.deepEqual(errorsOf({ collections: names.map((n) => weekly(n, WED)) }), [
    { field: "night", message: "Tuesday night's line is too long for the wall (47 of 44 characters). Shorten a bin name." },
  ]);
  // a fortnightly bin only makes the night too long on its own week; the check still finds it
  const mixed = { collections: [weekly("Garden organics", WED), weekly("General waste", WED), fortnightly("Cans", "2026-11-04", WED)] };
  assert.equal(errorsOf(mixed)[0].field, "night");
});

test("checkBins: duplicate, blank, 21-character and letterless names are refused with the exact copy", () => {
  assert.deepEqual(errorsOf({ collections: [weekly("Glass"), weekly("glass")] }), [{ row: 1, field: "name", message: "Another bin already has this name." }]);
  assert.deepEqual(errorsOf({ collections: [weekly("   ")] }), [{ row: 0, field: "name", message: "Name this bin, or remove it." }]);
  assert.deepEqual(errorsOf({ collections: [weekly("A".repeat(21))] }), [{ row: 0, field: "name", message: "Bin names are 20 characters at most." }]);
  assert.deepEqual(errorsOf({ collections: [weekly("--")] }), [{ row: 0, field: "name", message: "Use letters or numbers in the bin name." }]);
  assert.equal(checkBins({ collections: [weekly("A".repeat(20))] }).ok, true);
  assert.equal(checkBins({ collections: [weekly("Bin 2")] }).ok, true);
});

test("checkBins: a name that is only invisible characters counts as blank", () => {
  assert.equal(errorsOf({ collections: [weekly(`${ZWSP}${ZWJ}${BOM}`)] })[0].message, "Name this bin, or remove it.");
});

test("checkBins: weekday, repeat and date inputs", () => {
  const msg = (row: object) => errorsOf({ collections: [row] }).map((e) => e.message);
  assert.deepEqual(msg({ name: "Glass", every: 1 }), ["Pick the day the truck comes."]);
  assert.deepEqual(msg({ name: "Glass", weekday: 7, every: 1 }), ["Pick the day the truck comes."]);
  assert.deepEqual(msg({ name: "Glass", weekday: 1.5, every: 1 }), ["Pick the day the truck comes."]);
  assert.deepEqual(msg({ name: "Glass", weekday: 1, every: 3 }), ["Pick how often this bin is collected."]);
  assert.deepEqual(msg({ name: "Glass", weekday: TUE, every: 2 }), ["Pick any date this bin is collected."]);
  assert.deepEqual(msg({ name: "Glass", weekday: TUE, every: 2, anchor: "  " }), ["Pick any date this bin is collected."]);
  for (const bad of ["1999-12-28", "2100-01-05", "2026-02-30", "2026-2-3", "tomorrow"]) {
    assert.deepEqual(msg({ name: "Glass", weekday: TUE, every: 2, anchor: bad }), ["Pick a date between 2000 and 2099."]);
  }
  assert.equal(checkBins({ collections: [fortnightly("Glass", "2000-01-04")] }).ok, true); // a Tuesday, first accepted year
  assert.equal(checkBins({ collections: [fortnightly("Glass", "2099-12-29")] }).ok, true); // a Tuesday, last accepted year
});

test("checkBins: one to four bins", () => {
  const five = { collections: ["A", "B", "C", "D", "E"].map((n) => weekly(n)) };
  assert.deepEqual(errorsOf(five), [{ field: "bins", message: "Four bins at most." }]);
  assert.deepEqual(errorsOf({ collections: [] }), [{ field: "bins", message: "Add a bin, or clear the schedule." }]);
  for (const junk of [null, "x", 3, [], {}, { collections: "x" }]) assert.equal(checkBins(junk).ok, false);
  assert.equal(checkBins({ collections: ["A", "B", "C", "D"].map((n) => weekly(n, 1)) }).ok, true);
});

test("checkBins: a bad row never throws and every refused row is reported", () => {
  const errs = errorsOf({ collections: [null, weekly("Glass"), "x"] });
  assert.deepEqual(errs.map((e) => e.row), [0, 0, 0, 2, 2, 2]);
});

// N10: every night the checker accepts fits the wall, on every day of the 14-day cycle
test("N10: an accepted rule never produces a line over 44 characters", () => {
  const lens = [3, 12, 20];
  let accepted = 0;
  let refused = 0;
  const names = (n: number, pick: number) => Array.from({ length: n }, (_, i) => `${"n".repeat(lens[Math.floor(pick / 3 ** i) % 3] - 1)}${i}`);
  for (let n = 1; n <= 4; n++) {
    for (let pick = 0; pick < 3 ** n; pick++) {
      for (let mix = 0; mix < 2 ** n; mix++) {
        const rows = names(n, pick).map((name, i) => ((mix >> i) & 1 ? fortnightly(name, "2026-11-03") : weekly(name)));
        const c = checkBins({ collections: rows });
        if (!c.ok) { refused++; continue; }
        accepted++;
        for (let d = 0; d < 14; d++) {
          const today = new Date(Date.UTC(2026, 10, 1 + d)).toISOString().slice(0, 10);
          const night = nextBinNight(c.value, today);
          assert.ok(night && binLine(night.bins).length <= 44, `${JSON.stringify(rows)} on ${today}`);
        }
      }
    }
  }
  assert.ok(accepted > 100 && refused > 10, `accepted ${accepted}, refused ${refused}`);
});

// ---- the config write: the pure merge the route uses ----
const synthetic = {
  widgets: [{ id: "w1", type: "generic", name: "Example" }],
  display: { place: "Example Town", timezone: "Australia/Sydney" },
  homeassistant: { url: "http://ha.example.invalid", token: "placeholder-token", updatedAt: "2026-01-01T00:00:00Z" },
  groups: { web: ["a", "b"] },
} as unknown as AppConfig;
const nextOf = (r: ReturnType<typeof mergeBins>): AppConfig => {
  if ("error" in r) throw new Error(r.error);
  return r.next;
};

test("mergeBins: saving then clearing leaves every other key deep-equal and removes the key", () => {
  const before = structuredClone(synthetic);
  const saved = nextOf(mergeBins(synthetic, { collections: [{ name: " Recycling ", weekday: TUE, every: 1, junk: 1 }], more: 1 }));
  assert.deepEqual(saved.bins, { collections: [{ name: "Recycling", weekday: TUE, every: 1 }] });
  const { bins, ...rest } = saved;
  assert.ok(bins);
  assert.deepEqual(rest, before);
  const cleared = nextOf(mergeBins(saved, null));
  assert.equal("bins" in cleared, false);
  assert.deepEqual(cleared, before);
  assert.deepEqual(synthetic, before, "the input config is not mutated");
});

test("mergeBins: a refused rule stores nothing and returns the first message", () => {
  assert.deepEqual(mergeBins(synthetic, { collections: [weekly("Glass"), weekly("glass")] }), { error: "Another bin already has this name." });
  assert.deepEqual(mergeBins(synthetic, "nope"), { error: "The bin schedule isn't valid." });
  assert.deepEqual(mergeBins(synthetic, undefined), { error: "The bin schedule isn't valid." });
});

// ---- the public payload ----
test("binsPayload: only the three shapes, and a bad stored rule is an error that echoes nothing", () => {
  assert.deepEqual(binsPayload(undefined, "2026-11-16"), { status: "unconfigured" });
  const ok = binsPayload({ collections: [{ name: "Recycling", weekday: TUE, every: 1, secretNote: "x" }] }, "2026-11-16");
  assert.deepEqual(ok, { status: "ok", night: { date: "2026-11-16", bins: ["Recycling"] } });
  const bad = binsPayload({ collections: [{ name: "Private name", weekday: 9, every: 1 }] }, "2026-11-16");
  assert.deepEqual(bad, { status: "error" });
  assert.equal(JSON.stringify(bad).includes("Private"), false);
  for (const junk of [null, "x", 3, [], {}]) assert.deepEqual(binsPayload(junk, "2026-11-16"), { status: "error" });
});
