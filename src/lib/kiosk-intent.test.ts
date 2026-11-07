import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchIntent, type IntentContext } from "./kiosk-intent.ts";

// Fake house. Names are invented; entity ids follow HA's domain.period shape.
const house: IntentContext = {
  entities: {
    lights: [
      { entityId: "light.kitchen_lamp", name: "Kitchen Lamp", on: false, brightnessPct: null, available: true },
      { entityId: "light.study_desk", name: "Study Desk", on: false, brightnessPct: null, available: true },
      { entityId: "light.front_door_floodlight", name: "Front Door Floodlight", on: false, brightnessPct: null, available: true },
    ],
    switches: [],
    climates: [
      {
        entityId: "climate.office_ac",
        name: "Office AC",
        hvacMode: "off",
        hvacModes: ["off", "heat", "cool"],
        currentTemp: 20,
        targetTemp: 21,
        targetTempLow: null,
        targetTempHigh: null,
        unit: "C",
        available: true,
      },
    ],
    locks: [],
    sensors: [],
    scenes: [{ entityId: "scene.movie_night", name: "Movie Night", available: true }],
    mediaPlayers: [],
  },
};

const light = (entityId: string, name: string, available = true) =>
  ({ entityId, name, on: false, brightnessPct: null, available });

describe("matchIntent", () => {
  describe("one case per intent kind", () => {
    it("light turn_on resolves the named light", () => {
      assert.deepEqual(matchIntent("Turn on the kitchen lamp", house), {
        kind: "light",
        entityId: "light.kitchen_lamp",
        action: "turn_on",
        say: "Turning on Kitchen Lamp.",
      });
    });

    it("light turn_off resolves the named light", () => {
      assert.deepEqual(matchIntent("Switch off the study desk light.", house), {
        kind: "light",
        entityId: "light.study_desk",
        action: "turn_off",
        say: "Turning off Study Desk.",
      });
    });

    it("light toggle resolves the named light", () => {
      assert.deepEqual(matchIntent("Flip the kitchen lamp", house), {
        kind: "light",
        entityId: "light.kitchen_lamp",
        action: "toggle",
        say: "Toggling Kitchen Lamp.",
      });
    });

    it("scene resolves the named scene", () => {
      assert.deepEqual(matchIntent("Activate movie night", house), {
        kind: "scene",
        entityId: "scene.movie_night",
        say: "Activating Movie Night.",
      });
    });

    it("climate.power on resolves the named climate entity", () => {
      assert.deepEqual(matchIntent("Turn on the office AC", house), {
        kind: "climate.power",
        entityId: "climate.office_ac",
        on: true,
        say: "Turning on Office AC.",
      });
    });

    it("climate.power off resolves the named climate entity", () => {
      assert.deepEqual(matchIntent("turn off the office ac", house), {
        kind: "climate.power",
        entityId: "climate.office_ac",
        on: false,
        say: "Turning off Office AC.",
      });
    });

    it("climate.temp sets a degree value in range", () => {
      assert.deepEqual(matchIntent("Set the office AC to 22 degrees", house), {
        kind: "climate.temp",
        entityId: "climate.office_ac",
        temperature: 22,
        say: "Setting Office AC to 22 degrees.",
      });
    });

    it("climate.mode picks a supported hvac mode", () => {
      assert.deepEqual(matchIntent("Put the office on heat", house), {
        kind: "climate.mode",
        entityId: "climate.office_ac",
        hvacMode: "heat",
        say: "Setting Office AC to heat.",
      });
    });

    it("camera answers a request to see the front door", () => {
      assert.deepEqual(matchIntent("Show me the front door", house), {
        kind: "camera",
        say: "Showing the front door.",
      });
    });

    it("ask passes an unmatched question through unchanged", () => {
      assert.deepEqual(matchIntent("What is the weather like today", house), {
        kind: "ask",
        question: "What is the weather like today",
      });
    });

    it("unresolved answers empty input with a prompt to repeat", () => {
      assert.deepEqual(matchIntent("", house), { kind: "unresolved", say: "I didn't catch that." });
    });
  });

  describe("normalisation", () => {
    it("ignores case, punctuation and extra whitespace", () => {
      const plain = matchIntent("turn on the kitchen lamp", house);
      assert.deepEqual(matchIntent("TURN ON THE KITCHEN LAMP!!!", house), plain);
      assert.deepEqual(matchIntent("turn on, the kitchen lamp.", house), plain);
      assert.deepEqual(matchIntent("  turn   on the\tkitchen   lamp  ", house), plain);
    });

    it("whitespace or punctuation only is treated as empty", () => {
      const empty = { kind: "unresolved", say: "I didn't catch that." };
      assert.deepEqual(matchIntent("   ", house), empty);
      assert.deepEqual(matchIntent("?!", house), empty);
    });
  });

  describe("resolution", () => {
    it("a tie between two similar names asks which one, and picks neither", () => {
      const twoKitchen: IntentContext = {
        entities: { ...house.entities!, lights: [light("light.kitchen_lamp", "Kitchen Lamp"), light("light.kitchen_strip", "Kitchen Strip Light")] },
      };
      assert.deepEqual(matchIntent("turn on the kitchen light", twoKitchen), {
        kind: "unresolved",
        say: "Which light did you mean?",
      });
    });

    it("an extra word breaks the tie toward the stronger match", () => {
      const twoKitchen: IntentContext = {
        entities: { ...house.entities!, lights: [light("light.kitchen_lamp", "Kitchen Lamp"), light("light.kitchen_strip", "Kitchen Strip Light")] },
      };
      assert.deepEqual(matchIntent("turn on the kitchen strip", twoKitchen), {
        kind: "light",
        entityId: "light.kitchen_strip",
        action: "turn_on",
        say: "Turning on Kitchen Strip Light.",
      });
    });

    it("an unavailable light is never targeted", () => {
      const lampDown: IntentContext = {
        entities: { ...house.entities!, lights: [light("light.kitchen_lamp", "Kitchen Lamp", false)] },
      };
      assert.deepEqual(matchIntent("turn on the kitchen lamp", lampDown), {
        kind: "unresolved",
        say: "I couldn't find that light.",
      });
    });

    it("a lone light answers 'turn on the light' without a name", () => {
      const one: IntentContext = { entities: { ...house.entities!, lights: [light("light.hall", "Hall Light")] } };
      assert.deepEqual(matchIntent("turn on the light", one), {
        kind: "light",
        entityId: "light.hall",
        action: "turn_on",
        say: "Turning on Hall Light.",
      });
    });

    it("'turn on the light' with several lights and no name asks, not guesses", () => {
      assert.deepEqual(matchIntent("turn on the light", house), {
        kind: "unresolved",
        say: "I couldn't find that light.",
      });
    });

    it("a temperature outside 5 to 35 is not climate.temp", () => {
      assert.deepEqual(matchIntent("Set the office AC to 40", house), {
        kind: "ask",
        question: "Set the office AC to 40",
      });
    });

    it("null entities (nothing loaded yet) answer without throwing", () => {
      assert.deepEqual(matchIntent("turn on the kitchen lamp", { entities: null }), {
        kind: "unresolved",
        say: "I couldn't find that light.",
      });
    });

    it("an ask question is capped at 500 characters", () => {
      const long = "x".repeat(600);
      const out = matchIntent(long, house);
      assert.equal(out.kind, "ask");
      assert.equal(out.kind === "ask" ? out.question.length : -1, 500);
    });
  });

  describe("light and climate sharing a room word", () => {
    // A room name that shares a word with a light makes the light branch win
    // over the climate branch: kiosk-intent.ts:222-230 runs before the
    // climate.power branch at :233, and fires on any light token match.
    const sharedWord: IntentContext = {
      entities: { ...house.entities!, lights: [light("light.office_desk", "Office Desk")] },
    };

    it("'turn on the office ac' is climate.power, not the office desk light", () => {
      assert.deepEqual(matchIntent("turn on the office ac", sharedWord), {
        kind: "climate.power",
        entityId: "climate.office_ac",
        on: true,
        say: "Turning on Office AC.",
      });
    });

    it("'turn on the office light' stays a light when both share 'office'", () => {
      assert.deepEqual(matchIntent("turn on the office light", sharedWord), {
        kind: "light",
        entityId: "light.office_desk",
        action: "turn_on",
        say: "Turning on Office Desk.",
      });
    });
    it("the office heater goes to the office AC even with a light named Bathroom Heater", () => {
      const ctx: IntentContext = { entities: { ...house.entities!, lights: [light("light.bath_heater", "Bathroom Heater")] } };
      assert.deepEqual(matchIntent("turn on the office heater", ctx), {
        kind: "climate.power",
        entityId: "climate.office_ac",
        on: true,
        say: "Turning on Office AC.",
      });
    });
    it("a light whose own name holds a climate word is still a light", () => {
      const ctx: IntentContext = { entities: { ...house.entities!, lights: [light("light.bath_heater", "Bathroom Heater")] } };
      assert.deepEqual(matchIntent("turn on the bathroom heater", ctx), {
        kind: "light",
        entityId: "light.bath_heater",
        action: "turn_on",
        say: "Turning on Bathroom Heater.",
      });
    });
  });
});

describe("whole-word name matching (hunt 8 A6)", () => {
  const ctx: IntentContext = {
    entities: {
      ...house.entities!,
      lights: [light("light.den", "Den Light"), light("light.garden", "Garden Light")],
    },
  };
  it("garden does not match Den", () => {
    const got = matchIntent("turn off the garden light", ctx);
    assert.equal(got.kind === "light" && got.entityId, "light.garden");
  });
  it("den still matches Den", () => {
    const got = matchIntent("turn off the den light", ctx);
    assert.equal(got.kind === "light" && got.entityId, "light.den");
  });
});
