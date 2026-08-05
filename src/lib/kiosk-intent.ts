/* THESIS: the assistant resolves DEVICE CONTROL with deterministic matching,
   never with the LLM.

   Hermes (the sibling daemon that owns the model) has no tool-calling: its
   only conversational entry point is `POST /run {kind:"ask", question}`, which
   returns prose. Making a light switch depend on that would mean a wall
   display where "turn on the floodlight" takes several seconds, goes out to
   OpenRouter, and fails whenever the internet does — for an action the user
   can already perform by tapping a tile six inches away. So the router below
   matches intents locally and instantly, and the LLM is reserved for the one
   thing it is actually better at: answering open questions.

   The matcher is deliberately CONSERVATIVE. When the target is ambiguous or
   absent it returns an `unresolved` intent carrying a question, rather than
   guessing. On a shared house display, silently heating the wrong room is a
   worse failure than asking which room was meant — the cost of a wrong guess
   is paid by someone who wasn't in the conversation.

   Everything here is pure: it takes an utterance plus a snapshot of what
   exists, and returns a description of what to do. It performs no I/O and
   knows nothing about HTTP, so the route can re-resolve entities server-side
   and run the same function over trustworthy data. */

import type { HaClimate, HaEntities, HaLight, HaScene } from "@/lib/ha-types";

/* ── the intent shape ────────────────────────────────────────────────────── */

export type KioskIntent =
  | { kind: "light"; entityId: string; action: "turn_on" | "turn_off" | "toggle"; say: string }
  | { kind: "scene"; entityId: string; say: string }
  | { kind: "climate.power"; entityId: string; on: boolean; say: string }
  | { kind: "climate.temp"; entityId: string; temperature: number; say: string }
  | { kind: "climate.mode"; entityId: string; hvacMode: string; say: string }
  | { kind: "camera"; say: string }
  | { kind: "ask"; question: string }
  /** Matched a verb but not a target, or matched more than one target. Carries
   *  the question to put back to the person — never a silent no-op. */
  | { kind: "unresolved"; say: string };

export interface IntentContext {
  entities: HaEntities | null;
}

/* Container lifecycle ("restart sonarr") is deliberately NOT an intent.
   Measured against the live daemon: those phrasings fall through to `ask`, and
   hermes answers them well — it names the container, reports its actual state,
   and explains that lifecycle actions belong in the dashboard. Matching them
   locally instead would mean listing Docker containers on EVERY utterance,
   including "what's the weather", to serve a request that is rare on a wall
   display and that this surface declines anyway. A first draft did carry a
   `container` intent; it was unreachable dead code because nothing ever
   populated the container list, which is exactly how it was found. */

/* ── text normalisation ──────────────────────────────────────────────────── */

/** Lowercase, strip punctuation, collapse whitespace. Speech-to-text output
 *  arrives with sentence casing and trailing full stops that would otherwise
 *  break naive `includes` checks ("Turn on the floodlight." vs "floodlight"). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens of an entity's friendly name that are worth matching on. Drops the
 *  filler words that appear in nearly every HA name ("the", "front", …only as
 *  a whole-name fallback) so "office" still matches "Office AC" without
 *  "front" matching every entity in the house. */
function nameTokens(name: string): string[] {
  return norm(name)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP_TOKENS.has(t));
}

const STOP_TOKENS = new Set(["the", "and", "ac", "unit", "room", "light", "lights", "switch"]);

/* Words a person uses for the outdoor floodlight that appear nowhere in its
   HA friendly name ("Front door Floodlight"). Without these, "turn on the
   flashlight" — which is exactly what the owner calls it — matches nothing.
   Mapped by intent, not by entity id, so it still resolves if the entity is
   ever renamed, as long as it is still the only floodlight-ish light. */
const FLOODLIGHT_WORDS = ["floodlight", "flood light", "flashlight", "flash light", "outside light", "outdoor light", "porch light", "front light", "security light"];

/* ── scoring ─────────────────────────────────────────────────────────────── */

interface Candidate<T> {
  item: T;
  score: number;
}

/** Scores an entity against the utterance by counting how many of its
 *  distinctive name tokens appear. Returns the best match ONLY when it is a
 *  strict winner — a tie means genuine ambiguity and the caller must ask. */
function bestMatch<T extends { name: string; entityId: string }>(
  text: string,
  items: readonly T[],
): { match: T | null; ambiguous: boolean } {
  const scored: Candidate<T>[] = [];
  for (const item of items) {
    const tokens = nameTokens(item.name);
    if (tokens.length === 0) continue;
    let score = 0;
    for (const t of tokens) if (text.includes(t)) score += 1;
    if (score > 0) scored.push({ item, score });
  }
  if (scored.length === 0) return { match: null, ambiguous: false };
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { match: null, ambiguous: true };
  }
  return { match: scored[0].item, ambiguous: false };
}

/** The single-candidate shortcut: with exactly one light in the house, "turn
 *  on the light" is unambiguous even though no name token matched. Applied
 *  only when the pool has one member, so it can never mask a real ambiguity. */
function soleOr<T>(pool: readonly T[], matched: T | null): T | null {
  if (matched) return matched;
  return pool.length === 1 ? pool[0] : null;
}

/* ── verb detection ──────────────────────────────────────────────────────── */

const ON_WORDS = /\b(turn on|switch on|put on|on|enable|activate|start)\b/;
const OFF_WORDS = /\b(turn off|switch off|put out|off|disable|stop|kill)\b/;
const TOGGLE_WORDS = /\b(toggle|flip)\b/;

/** OFF is tested before ON deliberately: "turn off" contains no "on" token as
 *  a whole word, but phrasings like "switch the light off" would satisfy both
 *  patterns, and in every such phrasing the intent is off. */
function onOff(text: string): "turn_on" | "turn_off" | "toggle" | null {
  if (TOGGLE_WORDS.test(text)) return "toggle";
  if (OFF_WORDS.test(text)) return "turn_off";
  if (ON_WORDS.test(text)) return "turn_on";
  return null;
}

const HVAC_WORDS: readonly { re: RegExp; mode: string; label: string }[] = [
  { re: /\b(heat|heating|warm)\b/, mode: "heat", label: "heat" },
  { re: /\b(cool|cooling|aircon|air con|cold)\b/, mode: "cool", label: "cool" },
  { re: /\b(fan only|fan)\b/, mode: "fan_only", label: "fan" },
  { re: /\b(dry|dehumidif)\w*\b/, mode: "dry", label: "dry" },
  { re: /\bauto\w*\b/, mode: "auto", label: "auto" },
];

const CAMERA_WORDS = /\b(camera|front door|doorbell|who is at|who's at|whos at|door cam)\b/;

/* ── the matcher ─────────────────────────────────────────────────────────── */

export function matchIntent(utterance: string, ctx: IntentContext): KioskIntent {
  const text = norm(utterance);
  if (!text) return { kind: "unresolved", say: "I didn't catch that." };

  const ents = ctx.entities;
  const lights: HaLight[] = ents?.lights.filter((l) => l.available) ?? [];
  const scenes: HaScene[] = ents?.scenes.filter((s) => s.available) ?? [];
  const climates: HaClimate[] = ents?.climates.filter((c) => c.available) ?? [];

  /* Camera first: "show the front door" contains "front door", which would
     also token-match the floodlight ("Front door Floodlight"). Checking the
     camera phrasing before any entity matching stops a request to SEE the
     door from turning a light on instead. */
  if (CAMERA_WORDS.test(text) && !/\b(light|floodlight|flashlight)\b/.test(text)) {
    return { kind: "camera", say: "Showing the front door." };
  }

  const verb = onOff(text);

  /* ── climate ── */
  const mentionsClimate = /\b(ac|air ?con|aircon|heater|heating|cooling|thermostat|climate|temperature|degrees|temp)\b/.test(text);
  const climateTarget = bestMatch(text, climates);
  const climateEntity = climateTarget.match ?? (mentionsClimate ? soleOr(climates, null) : null);

  // "set the kitchen to 22" / "make the office 21 degrees"
  const degreeMatch = text.match(/\b(\d{1,2})(?:\.5)?\s*(?:degrees?|deg|c)?\b/);
  const wantsTemp = /\b(set|make|change|put)\b/.test(text) || /\bdegrees?\b/.test(text);
  if (degreeMatch && wantsTemp && climates.length > 0) {
    const temperature = Number(degreeMatch[0].match(/[\d.]+/)?.[0]);
    if (Number.isFinite(temperature) && temperature >= 5 && temperature <= 35) {
      if (climateTarget.ambiguous) {
        return { kind: "unresolved", say: "Which room did you mean?" };
      }
      const target = climateEntity;
      if (!target) {
        return { kind: "unresolved", say: `Which room should I set to ${temperature} degrees?` };
      }
      return {
        kind: "climate.temp",
        entityId: target.entityId,
        temperature,
        say: `Setting ${target.name} to ${temperature} degrees.`,
      };
    }
  }

  // "put the office on heat"
  if (climateEntity || (mentionsClimate && climates.length > 0)) {
    for (const h of HVAC_WORDS) {
      if (!h.re.test(text)) continue;
      if (climateTarget.ambiguous) return { kind: "unresolved", say: "Which room did you mean?" };
      const target = climateEntity;
      if (!target) return { kind: "unresolved", say: `Which room should I set to ${h.label}?` };
      if (!target.hvacModes.includes(h.mode)) {
        return { kind: "unresolved", say: `${target.name} doesn't support ${h.label}.` };
      }
      return {
        kind: "climate.mode",
        entityId: target.entityId,
        hvacMode: h.mode,
        say: `Setting ${target.name} to ${h.label}.`,
      };
    }
  }

  /* ── lights ── */
  const wantsFloodlight = FLOODLIGHT_WORDS.some((w) => text.includes(w));
  const lightTarget = bestMatch(text, lights);
  const mentionsLight = /\b(light|lights|lamp)\b/.test(text) || wantsFloodlight;

  if (verb && (mentionsLight || lightTarget.match || wantsFloodlight)) {
    if (lightTarget.ambiguous) return { kind: "unresolved", say: "Which light did you mean?" };
    const target = soleOr(lights, lightTarget.match);
    if (target) {
      const verbLabel = verb === "turn_on" ? "Turning on" : verb === "turn_off" ? "Turning off" : "Toggling";
      return { kind: "light", entityId: target.entityId, action: verb, say: `${verbLabel} ${target.name}.` };
    }
    if (mentionsLight) return { kind: "unresolved", say: "I couldn't find that light." };
  }

  /* ── climate power (after lights: "turn on the light" must not reach here) ── */
  if (verb && verb !== "toggle" && (climateEntity || mentionsClimate)) {
    if (climateTarget.ambiguous) return { kind: "unresolved", say: "Which room did you mean?" };
    const target = climateEntity;
    if (!target) return { kind: "unresolved", say: "Which room did you mean?" };
    const on = verb === "turn_on";
    return {
      kind: "climate.power",
      entityId: target.entityId,
      on,
      say: `${on ? "Turning on" : "Turning off"} ${target.name}.`,
    };
  }

  /* ── scenes ── */
  if (scenes.length > 0) {
    const sceneTarget = bestMatch(text, scenes);
    if (sceneTarget.ambiguous) return { kind: "unresolved", say: "Which scene did you mean?" };
    if (sceneTarget.match && (/\b(scene|activate|set|run)\b/.test(text) || verb === "turn_on")) {
      return { kind: "scene", entityId: sceneTarget.match.entityId, say: `Activating ${sceneTarget.match.name}.` };
    }
  }

  /* ── fall through to the model ──
     Container lifecycle phrasings land here on purpose; see the note on
     IntentContext above for why they are not matched locally. */
  return { kind: "ask", question: utterance.slice(0, 500) };
}
