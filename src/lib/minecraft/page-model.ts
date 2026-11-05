/* /minecraft's whole story in one pure function: the head (chip, answer, evidence, notice), the six strips in the
 * order the answer implies, which strip the answer names, and which writes are on. Type-only imports so node:test
 * can load it. Section 5 and 6 of the strips shape brief are the spec; page-model.test.ts has one case per row. */
import type { MinecraftStatusResponse } from "../client.ts";
import { formatUptime } from "../format.ts";
import { ageText } from "../home.ts";
import { canRestore } from "../mc-backup-reason.ts";
import type { McBackup } from "./manager.ts";

export type StripId = "server" | "players" | "pack" | "backups" | "console" | "log";
export type WriteId =
  | "stop" | "start" | "restart" | "pause" | "resume" | "switch" | "delete" | "install" | "upload"
  | "console-send" | "backup-run" | "restore" | "log-pause";
export type Tone = "ok" | "neutral" | "warn" | "bad";

export interface McContainer {
  state: string;
  exitCode: number | null;
  startedAt: number | null;
}
export interface ModelInput {
  status: MinecraftStatusResponse | undefined;
  /** The status poll is failing right now (SWR keeps the last good `status`). */
  statusError: boolean;
  container: McContainer | undefined;
  /** False until the container list has answered once. */
  containersReady: boolean;
  backups: McBackup[] | undefined;
  backupsError: boolean;
  lastLine: string | null;
  /** ms of the last good status answer, null before the first. */
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
}

const STALE_MS = 30_000;
const STARTING_MS = 5 * 60_000;
const SETTINGS = { href: "/settings#integrations", label: "Open Settings" };
const TITLES: Record<StripId, string> = { server: "Server", players: "Players", pack: "Pack", backups: "Backups", console: "Console", log: "Log" };
const ORDER = {
  default: ["server", "players", "pack", "backups", "console", "log"],
  crashed: ["server", "log", "pack", "backups", "players", "console"],
  noPack: ["pack", "server", "backups", "players", "console", "log"],
} as const satisfies Record<string, readonly StripId[]>;
const ALL_WRITES: WriteId[] = ["stop", "start", "restart", "pause", "resume", "switch", "delete", "install", "upload", "console-send", "backup-run", "restore", "log-pause"];
/** The full answer leads the strip the answer names, and only that one (R3). */
/** The Server detail says "no pack" only when mc-manager answered and listed none; down or rejected, it would be false advice. */
export const noPackNote = (s: MinecraftStatusResponse | undefined): string | null =>
  s?.manager === "ok" && !s.instances.some((p) => p.slug === s.active) ? "No pack active. Pick one in the Pack strip." : null;

export const leadFor = (m: Pick<Model, "autoTarget" | "detailLead">, id: StripId): string | null => (m.autoTarget === id ? m.detailLead : null);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function minecraftModel(i: ModelInput): Model {
  const { status, container: c, now } = i;
  const age = i.lastOkAt === null ? 0 : Math.max(0, now - i.lastOkAt);
  const done = (m: Omit<Model, "writes" | "detailLead">, writes: Model["writes"] = ALL_WRITES.map((id) => ({ id, enabled: false, reason: null }))): Model => ({
    ...m,
    detailLead: typeof m.autoTarget === "string" && m.autoTarget !== "keep" ? m.answer : null,
    writes,
  });

  if (!i.containersReady || (!status && !i.statusError)) {
    return done({
      chip: { tone: "neutral", label: "Checking" }, answer: "Connecting to mc-manager…", evidence: "First answer usually takes a second",
      notice: null, link: null, order: [...ORDER.default], strips: [], autoTarget: "keep",
    });
  }
  if (!status) {
    return done({
      chip: { tone: "warn", label: "No answer" }, answer: "The dashboard can’t reach its own status check. It tries again every 10 s.",
      evidence: "Check that the dashboard is running, then reload.", notice: null, link: null, order: [...ORDER.default], strips: [], autoTarget: "keep",
    });
  }
  if (status.manager === "unconfigured") {
    return done({
      chip: { tone: "neutral", label: "Not connected" }, answer: "Minecraft isn’t connected yet.",
      evidence: "Add the mc-manager address and token in Settings → Integrations.", notice: null, link: SETTINGS,
      order: [], strips: [], autoTarget: null,
    });
  }

  // ---- facts ----
  const running = c?.state === "running";
  const exited = c?.state === "exited";
  const cleanExit = c?.exitCode == null || c.exitCode === 0 || c.exitCode === 143; // 143 = SIGTERM, an operator stop
  const managerOk = status.manager === "ok";
  const active = status.instances.find((p) => p.slug === status.active);
  const crashed = managerOk && Boolean(active) && exited && !cleanExit;
  const noPack = managerOk && !active;
  const pl = status.players;
  const consoleLine = status.rcon === "unconfigured" ? "the console isn’t set up" : "the console isn’t answering";
  const uptimeMs = running && c?.startedAt ? now - c.startedAt : null;
  const stale = i.statusError || age > STALE_MS;

  // ---- head ----
  let chip: Model["chip"];
  let answer: string;
  let evidence = `Updated ${ageText(age)} ago · checks every 10 s`;
  let notice: string | null = null;
  let link: Model["link"] = null;
  let autoTarget: Model["autoTarget"] = null;
  let order: readonly StripId[] = ORDER.default;
  if (status.manager === "unauthorized") {
    chip = { tone: "warn", label: "Token rejected" };
    answer = "mc-manager rejected the token. Check it in Settings → Integrations.";
    link = SETTINGS;
    autoTarget = "server";
  } else if (!managerOk) {
    chip = { tone: "warn", label: "Manager down" };
    answer = "Docker says the server is running, but mc-manager isn’t answering. Packs, console and backups are paused.";
    // The raw error (host, port) stays out of the DOM.
    evidence = "mc-manager isn’t answering · retrying every 10 s";
    notice = "Start, stop and restart still work through Docker.";
    autoTarget = "server";
  } else if (crashed) {
    chip = { tone: "bad", label: "Crashed" };
    answer = `Minecraft is stopped: ${active!.name} failed to install.`;
    evidence = `Exited with code ${c!.exitCode} · the Log strip says why`;
    autoTarget = "server";
    order = ORDER.crashed;
  } else if (noPack) {
    chip = { tone: "neutral", label: "No pack" };
    answer = status.instances.length ? "No pack is active yet. Switch to one below." : "No modpack installed yet. Find one below to install it.";
    autoTarget = "pack";
    order = ORDER.noPack;
  } else if (!c) {
    chip = { tone: "neutral", label: "No container" };
    answer = "No minecraft container was found on this host.";
  } else if (c.state === "paused") {
    chip = { tone: "neutral", label: "Paused" };
    answer = "Minecraft is paused. Players can't move until you resume it.";
  } else if (!running) {
    chip = { tone: "neutral", label: "Stopped" };
    answer = `Minecraft is stopped. ${active ? `${active.name} is installed.` : ""}`.trim();
  } else {
    chip = { tone: "ok", label: "Running" };
    const who = pl ? (pl.online > 0 ? `${pl.online} of ${pl.max} players online.` : "Nobody is online.") : `Player count unknown: ${consoleLine}.`;
    answer = `Minecraft is running ${active?.name ?? "no pack"}. ${who}`;
  }
  if (stale) {
    chip = { tone: "neutral", label: "Stale" };
    answer = `Showing what was true ${ageText(age)} ago: ${lowerFirst(answer)}`;
    evidence = `Last update ${ageText(age)} ago · mc-manager stopped answering`;
    notice = "Controls are paused while the page shows old data.";
    autoTarget = "keep";
  }

  // ---- strips ----
  const packBackups = i.backups ?? [];
  const newest = packBackups.reduce<McBackup | null>((a, b) => (a && Date.parse(a.modifiedAt) >= Date.parse(b.modifiedAt) ? a : b), null);
  const serverState = !c
    ? "No container"
    : running
      ? status.rcon === "unavailable" && uptimeMs !== null && uptimeMs < STARTING_MS ? "Starting…" : `Running for ${formatUptime((uptimeMs ?? 0) / 1000)}`
      : c.state === "paused" ? "Paused" : crashed ? `Stopped: exit code ${c.exitCode}` : "Stopped";
  const state: Record<StripId, Pick<Strip, "state" | "tone">> = {
    server: { state: serverState, tone: crashed ? "bad" : null },
    players: {
      state: pl ? (pl.online > 0 ? `${pl.online} of ${pl.max} online` : "Nobody online") : !running ? "Server is stopped" : `Unknown: ${consoleLine}`,
      tone: null,
    },
    pack: { state: !managerOk ? "Paused: mc-manager isn’t answering" : active ? `${active.name} · ${active.source}` : "No pack installed", tone: null },
    backups: {
      state: !managerOk ? "Paused: mc-manager isn’t answering"
        : i.backupsError && !i.backups ? "Couldn’t load backups"
        : newest ? `Last ${ageText(now - Date.parse(newest.modifiedAt))} ago · ${packBackups.length} kept` : "No backups yet",
      tone: managerOk && i.backupsError && !i.backups ? "warn" : null,
    },
    console: { state: status.rcon === "ok" ? "Ready" : status.rcon === "unconfigured" ? "Not set up" : "Not answering", tone: null },
    log: { state: i.lastLine || "No log yet", tone: null },
  };
  const strips = order.map((id) => ({ id, title: TITLES[id], ...state[id] }));

  // ---- writes (section 6); stale turns every write off, Docker verbs need only a container ----
  const on: Partial<Record<WriteId, string | null>> = {};
  if (!stale) {
    if (c) {
      if (["running", "restarting", "paused"].includes(c.state)) on.stop = null;
      else on.start = null;
      if (running) on.restart = on.pause = null;
      if (c.state === "paused") on.resume = null;
    }
    if (managerOk) {
      for (const id of ["switch", "delete", "install", "upload"] as const) on[id] = null;
      if (status.rcon === "ok") on["console-send"] = null;
      if (running) on["backup-run"] = null;
      else if (c && canRestore(c.state)) on.restore = null;
    }
  }
  if (c) on["log-pause"] = null;
  const why = (id: WriteId): string | null => {
    if (stale) return "Controls are paused while the page shows old data.";
    if (!managerOk && id !== "stop" && id !== "start" && id !== "restart" && id !== "pause" && id !== "resume" && id !== "log-pause") return "mc-manager isn’t answering.";
    if (id === "console-send") return `Unavailable: ${consoleLine}.`;
    if (id === "backup-run") return "Start the server to back up.";
    if (id === "restore") return "Stop the server to restore.";
    return null;
  };
  return done(
    { chip, answer, evidence, notice, link, order: [...order], strips, autoTarget },
    ALL_WRITES.map((id) => ({ id, enabled: id in on, reason: id in on ? null : why(id) })),
  );
}
