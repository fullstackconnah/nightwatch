/* /smarthome's whole story in one pure function: the head (chip, answer, evidence, notice), the five strips in the
 * order the answer implies, which strip the answer names, and which writes are on. Type-only imports so node:test
 * can load it. Sections 5 and 6 of the strips shape brief are the spec; page-model.test.ts has a case per state. */
import { statusFor } from "../climate-auto-off.ts";
import { ageText } from "../home.ts";
import type { HaClimate, HaEntities, HaLock, HaStatesResponse } from "../types/ha.ts";

export type StripId = "climate" | "lock" | "lights" | "switches" | "sensors";
export type WriteId = "ac-mode" | "ac-nudge" | "light-toggle" | "switch-toggle" | "lock" | "unlock";
export type Tone = "ok" | "neutral" | "warn" | "bad";

/** A lock is a door: Lock and Unlock ask once and the question cancels itself after this long (moved from ha-locks.tsx). */
export const CONFIRM_WINDOW_MS = 4000;

/** What GET /kiosk/api/climate-auto-off returns (read-only here; the kiosk owns the schedule). */
export interface AutoOffRead {
  enabled: boolean;
  time: string;
  skipDate: string | null;
  lastRunDate: string | null;
}
export interface ModelInput {
  ha: HaStatesResponse | undefined;
  /** The poll is failing right now (SWR keeps the last good `ha`). */
  loadError: boolean;
  /** Undefined when the read failed or has not answered: the auto-off part is simply dropped. */
  autoOff: AutoOffRead | undefined;
  /** A lock write is in flight on this page. */
  lockBusy: boolean;
  /** ms of the last good answer, null before the first. */
  lastOkAt: number | null;
  now: number;
}
export interface Strip {
  id: StripId;
  title: string;
  state: string;
  tone: "warn" | "bad" | null;
}
export interface Model {
  chip: { tone: Tone; label: string };
  answer: string;
  evidence: string;
  notice: string | null;
  link: { href: string; label: string } | null;
  order: StripId[];
  strips: Strip[];
  /** The strip the answer names, null (none), or "keep" (loading, stale: leave things as they are). */
  autoTarget: StripId | null | "keep";
  /** The opened strip's detail starts with this, so a clamped answer is never lost (R3). */
  detailLead: string | null;
  writes: { id: WriteId; enabled: boolean; reason: string | null }[];
  /** The page shows old data: every write is off. */
  stale: boolean;
}

const STALE_MS = 30_000;
const PAUSED = "Controls are paused while the page shows old data.";
const SETTINGS = { href: "/settings#homeassistant", label: "Open Settings" };
const TITLES: Record<StripId, string> = { climate: "Climate", lock: "Lock", lights: "Lights", switches: "Switches", sensors: "Sensors" };
const ORDER = {
  default: ["climate", "lock", "lights", "switches", "sensors"],
  lockFirst: ["lock", "climate", "lights", "switches", "sensors"],
} as const satisfies Record<string, readonly StripId[]>;
const ALL_WRITES: WriteId[] = ["ac-mode", "ac-nudge", "light-toggle", "switch-toggle", "lock", "unlock"];
export const LOCK_WORD: Record<HaLock["state"], string> = {
  locked: "locked", unlocked: "unlocked", locking: "locking…", unlocking: "unlocking…", open: "open", opening: "opening…", jammed: "jammed", unavailable: "isn’t answering", unknown: "state unknown",
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const moving = (l: HaLock) => l.state === "locking" || l.state === "unlocking" || l.state === "opening";
const lockUp = (l: HaLock) => l.available && l.state !== "unavailable";

/** One lock's writes. Unlock is off while the data is old, the lock is not answering, or any lock is moving or has a write in flight. */
export function lockWrites(l: HaLock, o: { stale: boolean; busy: boolean }): { lock: boolean; unlock: boolean } {
  if (o.stale || o.busy || !lockUp(l) || moving(l)) return { lock: false, unlock: false };
  return { lock: l.state !== "locked", unlock: l.state !== "unlocked" && l.state !== "open" };
}
/** True while any lock is mid-move or this page has a lock write in flight. */
export const anyLockBusy = (locks: readonly HaLock[], lockBusy: boolean) => lockBusy || locks.some(moving);

/** One AC's writes: mode needs it answering; the target buttons also need it on and a target to move. */
export function acWrites(c: HaClimate, stale: boolean): { mode: boolean; nudge: boolean } {
  const mode = !stale && c.available;
  const hasTarget = c.targetTemp != null || (c.targetTempLow != null && c.targetTempHigh != null);
  return { mode, nudge: mode && c.hvacMode !== "off" && hasTarget };
}

const off = (): Model["writes"] => ALL_WRITES.map((id) => ({ id, enabled: false, reason: null }));
const done = (m: Omit<Model, "writes" | "detailLead" | "stale">, writes: Model["writes"] = off(), stale = false): Model => ({
  ...m,
  detailLead: typeof m.autoTarget === "string" && m.autoTarget !== "keep" ? m.answer : null,
  writes,
  stale,
});
const head = (tone: Tone, label: string, answer: string, evidence: string, extra: Partial<Model> = {}): Model =>
  done({ chip: { tone, label }, answer, evidence, notice: null, link: null, order: [...ORDER.default], strips: [], autoTarget: null, ...extra });

function names(list: string[]): string {
  const [a, b] = list;
  if (list.length === 1) return `${a} isn’t answering.`;
  if (list.length === 2) return `${a} and ${b} aren’t answering.`;
  return `${a}, ${b} and ${list.length - 2} more aren’t answering.`;
}

function lockSentence(locks: HaLock[]): string {
  if (locks.length === 0) return "";
  if (locks.length > 1 && locks.every((l) => l.state === "locked")) return `All ${locks.length} locks locked.`;
  const one = (l: HaLock) =>
    ({
      locked: `${l.name} locked.`, unlocked: `${l.name} unlocked.`, locking: `${l.name} is locking.`, unlocking: `${l.name} is unlocking.`,
      open: `${l.name} is open.`, opening: `${l.name} is opening.`,
      jammed: `The ${l.name.toLowerCase()} lock is jammed.`, unavailable: `${l.name} isn’t answering.`, unknown: `${l.name}’s state is unknown.`,
    })[l.state];
  const jammed = locks.filter((l) => l.state === "jammed");
  return (jammed.length ? jammed : locks.filter((l) => l.state !== "locked" || locks.length === 1)).map(one).join(" ");
}

export function smarthomeModel(i: ModelInput): Model {
  const { ha, now } = i;
  if (!ha) {
    return i.loadError
      ? head("warn", "No answer", "The dashboard can’t reach its own status check. It tries again every 3 s.", "Check that the dashboard is running, then reload.", { autoTarget: "keep" })
      : head("neutral", "Checking", "Connecting to Home Assistant…", "First answer usually takes a second", { autoTarget: "keep" });
  }
  // The upstream `detail` (it can hold a host) is never read.
  if (ha.status === "unconfigured") {
    return head("neutral", "Not connected", "Home Assistant isn’t connected yet.", "Add the Home Assistant address and token in Settings → Integrations.", { link: SETTINGS });
  }
  if (ha.status === "unauthorized") {
    return head("warn", "Token rejected", "Home Assistant rejected the access token. Check it in Settings → Integrations.", "Controls stay off until the token works.", { link: SETTINGS });
  }
  if (ha.status === "unreachable" || !ha.entities) {
    return head("warn", "Not answering", "Home Assistant isn’t answering. Controls are paused until it’s back.", "Retrying every 3 s.");
  }

  const e: HaEntities = ha.entities;
  const age = i.lastOkAt === null ? 0 : Math.max(0, now - i.lastOkAt);
  const stale = i.loadError || age > STALE_MS;
  const total = e.lights.length + e.switches.length + e.climates.length + e.locks.length + e.sensors.length;
  if (total === 0) return head("ok", "Connected", "Connected, but Home Assistant shares no devices yet.", `From Home Assistant · updated ${ageText(age)} ago · checks every 3 s`);

  // ---- facts ----
  const jammed = e.locks.some((l) => l.state === "jammed");
  const lockDown = e.locks.some((l) => !lockUp(l));
  const deviceDown = [...e.climates, ...e.lights, ...e.switches, ...e.sensors].filter((d) => !d.available);
  const acOn = e.climates.filter((c) => c.available && c.hvacMode !== "off").length;
  const lowBattery = e.sensors
    .filter((s) => s.kind === "battery" && s.available && s.value != null && s.value <= 20)
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
  let autoAnswer = "";
  let autoStrip = "";
  if (i.autoOff?.enabled && acOn > 0) {
    const s = statusFor({ enabled: true, time: i.autoOff.time, skipDate: i.autoOff.skipDate ?? undefined, lastRunDate: i.autoOff.lastRunDate ?? undefined }, new Date(now));
    if (s.kind === "scheduled") [autoAnswer, autoStrip] = [`, turning off at ${i.autoOff.time}`, ` · auto-off ${i.autoOff.time}`];
    if (s.kind === "skipped") [autoAnswer, autoStrip] = [", skipped tonight", " · skipped tonight"];
  }
  const n = e.climates.length;
  const acSentence = n === 0 ? "" : n === 1 ? `The AC is ${acOn ? "on" : "off"}${autoAnswer}.` : `${acOn} of ${n} ACs on${autoAnswer}.`;

  // ---- head ----
  const extras = [deviceDown.length ? names(deviceDown.map((d) => d.name)) : "", lowBattery ? `${lowBattery.name} is at ${lowBattery.value}%.` : ""].filter(Boolean);
  let answer = (jammed ? lockSentence(e.locks) : [lockSentence(e.locks), acSentence].filter(Boolean).join(" ")) + (extras.length ? ` ${extras.join(" ")}` : "");
  let chip: Model["chip"] = jammed ? { tone: "bad", label: "Lock jammed" } : lockDown || deviceDown.length ? { tone: "warn", label: "Partial" } : { tone: "ok", label: "Connected" };
  let evidence = `From Home Assistant · updated ${ageText(age)} ago · checks every 3 s`;
  let notice: string | null = null;
  const lockFirst = jammed || lockDown;
  const downStrip: StripId | undefined = (["climate", "lights", "switches", "sensors"] as const).find((id) =>
    ({ climate: e.climates, lights: e.lights, switches: e.switches, sensors: e.sensors })[id].some((d) => !d.available),
  );
  let autoTarget: Model["autoTarget"] = lockFirst ? "lock" : (downStrip ?? null);
  if (stale) {
    chip = { tone: "neutral", label: "Stale" };
    answer = `Showing what was true ${ageText(age)} ago: ${lowerFirst(answer)}`;
    evidence = `Last update ${ageText(age)} ago · Home Assistant stopped answering`;
    notice = PAUSED;
    autoTarget = "keep";
  }

  // ---- strips ----
  const count = (list: { on: boolean; available: boolean }[], extra = ""): Pick<Strip, "state" | "tone"> => {
    if (list.length === 0) return { state: "None shared", tone: null };
    const down = list.filter((x) => !x.available).length;
    return { state: `${list.filter((x) => x.on).length} of ${list.length} on${extra}${down ? ` · ${down} not answering` : ""}`, tone: down ? "warn" : null };
  };
  const lockStrip = (): Pick<Strip, "state" | "tone"> => {
    const worst = jammed ? "bad" : lockDown ? "warn" : null;
    if (e.locks.length === 0) return { state: "None shared", tone: null };
    if (e.locks.length === 1) return { state: `${e.locks[0].name} ${LOCK_WORD[e.locks[0].state]}`, tone: worst };
    const locked = e.locks.filter((l) => l.state === "locked").length;
    return { state: locked === e.locks.length ? `All ${locked} locked` : `${locked} of ${e.locks.length} locked`, tone: worst };
  };
  const sensorDown = e.sensors.filter((s) => !s.available).length;
  const state: Record<StripId, Pick<Strip, "state" | "tone">> = {
    climate: count(e.climates.map((c) => ({ on: c.hvacMode !== "off", available: c.available })), autoStrip),
    lock: lockStrip(),
    lights: count(e.lights),
    switches: count(e.switches),
    sensors: e.sensors.length === 0
      ? { state: "None shared", tone: null }
      : {
          state: `${e.sensors.length} ${e.sensors.length === 1 ? "reading" : "readings"}${lowBattery ? ` · ${lowBattery.name} ${lowBattery.value}%` : ""}${sensorDown ? ` · ${sensorDown} not answering` : ""}`,
          tone: lowBattery && (lowBattery.value ?? 99) <= 10 ? "bad" : lowBattery || sensorDown ? "warn" : null,
        },
  };
  const order = lockFirst ? ORDER.lockFirst : ORDER.default;
  const strips = order.map((id) => ({ id, title: TITLES[id], ...state[id] }));

  // ---- writes (section 6); stale turns every write off ----
  const busy = anyLockBusy(e.locks, i.lockBusy);
  const acs = e.climates.map((c) => acWrites(c, stale));
  const locks = e.locks.map((l) => lockWrites(l, { stale, busy }));
  const lockWhy = (verb: "lock" | "unlock"): string | null => {
    if (stale) return PAUSED;
    if (e.locks.length === 0) return "No lock is shared.";
    if (busy) return e.locks.some(moving) ? "A lock is moving. Wait for it to finish." : "Another lock command is in flight.";
    if (e.locks.every((l) => !lockUp(l))) return "The lock isn’t answering.";
    return verb === "lock" ? "Already locked." : "Already unlocked.";
  };
  const deviceWhy = (list: { available: boolean }[], none: string) => (stale ? PAUSED : list.some((d) => d.available) ? null : none);
  const on = (ok: boolean, why: string | null) => ({ enabled: ok, reason: ok ? null : why });
  const writes: Model["writes"] = [
    { id: "ac-mode", ...on(acs.some((a) => a.mode), deviceWhy(e.climates, "No AC is answering.")) },
    { id: "ac-nudge", ...on(acs.some((a) => a.nudge), stale ? PAUSED : acs.some((a) => a.mode) ? `Turn ${n === 1 ? "the" : "an"} AC on to change its target.` : "No AC is answering.") },
    { id: "light-toggle", ...on(!stale && e.lights.some((l) => l.available), deviceWhy(e.lights, "No light is answering.")) },
    { id: "switch-toggle", ...on(!stale && e.switches.some((s) => s.available), deviceWhy(e.switches, "No switch is answering.")) },
    { id: "lock", ...on(locks.some((l) => l.lock), lockWhy("lock")) },
    { id: "unlock", ...on(locks.some((l) => l.unlock), lockWhy("unlock")) },
  ];
  return done({ chip, answer, evidence, notice, link: null, order: [...order], strips, autoTarget }, writes, stale);
}
