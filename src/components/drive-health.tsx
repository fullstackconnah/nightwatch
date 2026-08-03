/* THESIS: a drive-health panel should answer "how much life is left" before it answers
   "how many attributes exist" — so the hero of every row is a life track, and the SMART
   table is what you open when the track has already told you something is wrong.
   OWN-WORLD: nightwatch console — near-black, hairline .panel, teal accent as the single
   data hue, mono numerals, 10px microlabels; magnitude = bar length, never rainbow.
   HONEST DATA: a drive with no wear indicator gets a hatched track reading "no wear
   telemetry", never an empty one. Absence must not be able to look like health. */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, relativeTime } from "@/lib/format";
import { useSmart } from "@/lib/client";
import type {
  AtaAttribute,
  DriveHealth,
  HealthVerdict,
  SmartSnapshot,
  SmartTempSensor,
} from "@/lib/smart-types";

/** Wear past this reads as "plan a replacement", and the track shows the line. */
const WEAR_WARN_PCT = 80;

const VERDICT_TEXT: Record<HealthVerdict, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  unknown: "text-ink-faint",
};

/** `.microlabel` sets its own colour, so overriding it on a microlabel element
 *  needs the important variant — plain `text-ok` loses on source order. */
const VERDICT_TEXT_STRONG: Record<HealthVerdict, string> = {
  ok: "!text-ok",
  warn: "!text-warn",
  bad: "!text-bad",
  unknown: "!text-ink-faint",
};

const VERDICT_FILL: Record<HealthVerdict, string> = {
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  bad: "var(--color-bad)",
  unknown: "var(--color-ink-faint)",
};

/**
 * Headline verdict. `unknown` deliberately does NOT become an alarm: this host
 * has a USB stick whose bridge cannot pass SMART commands through, so a naive
 * worst-of roll-up would pin the panel to "PARTIAL DATA" permanently — a
 * non-green state nobody can ever resolve, which is how people learn to ignore
 * a status line. Count instead, and let the drive's own row say it is unknowable.
 */
function headline(drives: DriveHealth[], overall: HealthVerdict): { text: string; tone: HealthVerdict } {
  if (overall === "bad") return { text: "ACTION NEEDED", tone: "bad" };
  if (overall === "warn") return { text: "NEEDS ATTENTION", tone: "warn" };
  const assessable = drives.filter((d) => d.verdict !== "unknown");
  if (assessable.length < drives.length) {
    return { text: `${assessable.length} OF ${drives.length} ASSESSABLE`, tone: "unknown" };
  }
  return { text: "ALL HEALTHY", tone: "ok" };
}

const BUS_LABEL: Record<DriveHealth["bus"], string> = {
  nvme: "NVMe",
  sata: "SATA",
  usb: "USB",
  unknown: "—",
};

/**
 * Temperature intent mirrors the server's verdict thresholds so the colour you see
 * and the reason text you read can never disagree. Drives that publish a critical
 * limit are judged against their own; the rest fall back to spinning-vs-solid
 * defaults, because 55 °C is unremarkable for an NVMe controller and alarming for
 * a 5400 rpm archive disk.
 */
function tempIntent(t: SmartTempSensor, rotational: boolean | null): HealthVerdict {
  const crit = t.criticalC ?? (rotational ? 60 : 75);
  const warn = t.criticalC != null ? t.criticalC - 15 : rotational ? 50 : 65;
  if (t.celsius >= crit) return "bad";
  if (t.celsius >= warn) return "warn";
  return "ok";
}

/** The sensor that decides the row's temperature colour: the hottest one. */
function hottest(temps: SmartTempSensor[]): SmartTempSensor | null {
  if (temps.length === 0) return null;
  return temps.reduce((a, b) => (b.celsius > a.celsius ? b : a));
}

/**
 * Hours → the coarsest unit that still says something useful. A projection this
 * soft does not deserve four significant figures; "~13 yr" is the honest precision.
 */
function formatLifetime(hours: number | null): string {
  if (hours == null) return "—";
  const days = hours / 24;
  if (days >= 730) return `~${(days / 365).toFixed(days / 365 >= 10 ? 0 : 1)} yr`;
  if (days >= 60) return `~${Math.round(days / 30)} mo`;
  if (days >= 2) return `~${Math.round(days)} d`;
  return `~${Math.round(hours)} h`;
}

function formatHours(hours: number | null): string {
  if (hours == null) return "—";
  return `${hours.toLocaleString()} h`;
}

function formatCount(n: number | null): string {
  return n == null ? "—" : n.toLocaleString();
}

/* ── the hero: one drive's life, or an honest refusal to guess ───────────── */

/**
 * Life track. Filled = endurance consumed, per the drive's own wear indicator.
 *
 * When `wearPct` is null the track switches to a hatched "no telemetry" state
 * rather than rendering empty. Spinning disks publish no wear figure at all, and
 * an empty track next to a full one reads as "this drive is pristine" — the exact
 * misreading this feature exists to prevent.
 */
function LifeTrack({
  wearPct,
  verdict,
  swept,
}: {
  wearPct: number | null;
  verdict: HealthVerdict;
  swept: boolean;
}) {
  if (wearPct == null) {
    return (
      <div
        className="h-2.5 rounded-full bg-panel-2 border border-line overflow-hidden"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--color-ink-faint) 35%, transparent) 5px 6px)",
        }}
        role="img"
        aria-label="No wear telemetry for this drive"
      />
    );
  }

  const pct = Math.max(0, Math.min(100, wearPct));
  const fill = verdict === "bad" ? VERDICT_FILL.bad : verdict === "warn" ? VERDICT_FILL.warn : "var(--color-accent-dim)";

  return (
    <div
      className="relative h-2.5 rounded-full bg-panel-2 border border-line overflow-hidden"
      role="img"
      aria-label={`${pct}% of rated endurance used`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${swept ? pct : 0}%`, background: fill }}
      />
      {/* The replacement-planning line. Drawn on top of the fill so it stays legible
          once wear crosses it, which is precisely when it matters. */}
      <div
        className="absolute inset-y-0 w-px bg-line-bright/80"
        style={{ left: `${WEAR_WARN_PCT}%` }}
        aria-hidden
      />
    </div>
  );
}

/* ── SMART attribute gauge: headroom above the drive's own failure threshold ── */

/**
 * ATA SMART is normalised so that a drive fails when VALUE drops to THRESH. The
 * bar therefore shows distance-to-threshold, not raw magnitude — a 200/140 that
 * has never moved reads full, and the same attribute at 141 reads nearly empty.
 * `worst` is drawn as a notch so a drive that recovered still shows its low-water mark.
 */
function AttributeGauge({ attr }: { attr: AtaAttribute }) {
  const headroom = attr.headroomPct;
  const intent: HealthVerdict = attr.failingNow
    ? "bad"
    : attr.failedBefore || (attr.critical && attr.rawValue > 0)
      ? "warn"
      : "ok";

  const worstPct =
    attr.thresh > 0 && attr.thresh < 100
      ? Math.max(0, Math.min(100, ((attr.worst - attr.thresh) / (100 - attr.thresh)) * 100))
      : null;

  return (
    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5">
      <div className="flex items-center gap-1.5 min-w-0">
        {attr.critical && (
          <span
            className="w-1 h-1 rounded-full bg-blue shrink-0"
            title="One of the attributes that actually predicts failure"
            aria-hidden
          />
        )}
        <span className="text-xs text-ink truncate" title={`${attr.id} · ${attr.name}`}>
          {attr.name.replace(/_/g, " ")}
        </span>
      </div>

      <div className="col-span-2 sm:col-span-1 order-last sm:order-none">
        {headroom == null ? (
          // Same hatch as the life track, and for the same reason: 14 of this
          // drive's 17 attributes publish no threshold, and an empty bar in a
          // column of full ones reads as "no health left" rather than "no scale
          // exists". These are informational counters, not failure predictors.
          <div
            className="h-1.5 rounded-full bg-panel-2 border border-line/70"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--color-ink-faint) 30%, transparent) 4px 5px)",
            }}
            title="This drive publishes no failure threshold for this attribute — it is a counter, not a predictor"
          />
        ) : (
          <div className="relative h-1.5 rounded-full bg-panel-2 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${headroom}%`, background: VERDICT_FILL[intent] }}
            />
            {worstPct != null && worstPct < 99.5 && (
              <div
                className="absolute inset-y-0 w-px bg-ink-faint"
                style={{ left: `${worstPct}%` }}
                title={`worst ever recorded: ${attr.worst}`}
                aria-hidden
              />
            )}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2 justify-end font-mono text-[0.7rem] shrink-0">
        <span className={cn(intent === "ok" ? "text-ink-dim" : VERDICT_TEXT[intent])}>{attr.raw}</span>
        <span className="text-ink-faint tabular-nums" title="current / worst / threshold">
          {attr.value}/{attr.worst}
          {attr.thresh > 0 ? `▸${attr.thresh}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ── NVMe stat tiles ─────────────────────────────────────────────────────── */

function Stat({
  label,
  value,
  intent = "ok",
  title,
}: {
  label: string;
  value: string;
  intent?: HealthVerdict;
  title?: string;
}) {
  return (
    <div title={title}>
      <div className="microlabel">{label}</div>
      <div className={cn("font-mono text-xs mt-0.5", intent === "ok" ? "text-ink" : VERDICT_TEXT[intent])}>
        {value}
      </div>
    </div>
  );
}

/* ── one drive ───────────────────────────────────────────────────────────── */

function DriveRow({ drive, swept }: { drive: DriveHealth; swept: boolean }) {
  const [open, setOpen] = useState(false);
  const top = hottest(drive.temps);
  const tempV = top ? tempIntent(top, drive.rotational) : "unknown";
  const panelId = `drive-detail-${drive.name}`;

  const spare =
    drive.availableSparePct != null && drive.availableSpareThresholdPct != null
      ? { pct: drive.availableSparePct, min: drive.availableSpareThresholdPct }
      : null;

  return (
    <div className="border-t border-line/60 first:border-t-0 py-3 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full text-left -mx-1 px-1 rounded-md cursor-pointer hover:bg-panel-2/60 min-h-11 md:min-h-0"
      >
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="flex items-baseline gap-2 min-w-0">
            {/* Shared `.dot` vocabulary (8px + glow), not a hand-rolled circle —
                every other status mark in the app (container-tile, process-table,
                hermes-status) reads through this same silhouette. Colour stays
                inline since VERDICT_FILL is a per-drive verdict, not one of the
                fixed container-lifecycle states `.dot-*` names. Glow uses
                color-mix rather than a template-literal alpha suffix on the
                var() string (`${VERDICT_FILL[...]}55`), which would emit invalid
                CSS like charts.tsx's Meter bug — color-mix wraps the var()
                properly instead. */}
            <span
              className="dot self-center"
              style={{
                background: VERDICT_FILL[drive.verdict],
                // Unknown mirrors `.dot-stopped`: nothing assessable, so nothing
                // glows — "unknowable" should not radiate the way a real state does.
                boxShadow:
                  drive.verdict === "unknown"
                    ? "none"
                    : `0 0 6px 1px color-mix(in srgb, ${VERDICT_FILL[drive.verdict]} 55%, transparent)`,
              }}
              aria-hidden
            />
            <span className="text-xs text-ink truncate">{drive.model ?? drive.name}</span>
            {/* The kernel name stays at every width — two identical drives are
                otherwise indistinguishable on a phone. Bus and capacity are the
                parts that can wait for room. */}
            <span className="microlabel shrink-0">{drive.name}</span>
            <span className="microlabel shrink-0 hidden sm:inline">
              {BUS_LABEL[drive.bus]}
              {drive.capacityBytes != null && ` · ${formatBytes(drive.capacityBytes, 0)}`}
            </span>
          </div>
          <ChevronDown
            size={13}
            className={cn("text-ink-faint transition-transform shrink-0 self-center", open && "rotate-180")}
            aria-hidden
          />
        </div>

        <LifeTrack wearPct={drive.wearPct} verdict={drive.verdict} swept={swept} />

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2 font-mono text-[0.7rem]">
          {drive.wearPct != null ? (
            <span className="text-ink">
              {drive.wearPct}% <span className="text-ink-faint">used</span>
            </span>
          ) : (
            <span className="text-ink-faint">no wear telemetry</span>
          )}

          {drive.projectedHoursRemaining != null ? (
            <span className="text-ink-dim" title="Extrapolated from the lifetime average wear rate, not a forecast">
              {formatLifetime(drive.projectedHoursRemaining)} left
            </span>
          ) : drive.wearPct === 0 ? (
            <span className="text-ink-faint" title="Wear is still reported as 0%, so no rate can be derived yet">
              lifetime not yet measurable
            </span>
          ) : null}

          {top && (
            <span className={VERDICT_TEXT[tempV]}>
              {top.celsius.toFixed(0)} °C
              {drive.temps.length > 1 && <span className="text-ink-faint"> peak</span>}
            </span>
          )}

          {drive.powerOnHours != null && (
            <span className="text-ink-faint">{formatHours(drive.powerOnHours)}</span>
          )}

          {!drive.smartAvailable && (
            <span className="text-ink-faint truncate" title={drive.unavailableReason ?? undefined}>
              SMART unavailable
            </span>
          )}
          {drive.standby && <span className="text-ink-faint">standby · not woken</span>}
        </div>

        {drive.reasons.length > 0 && (
          <div className={cn("mt-1.5 text-[0.7rem]", VERDICT_TEXT[drive.verdict])}>
            {drive.reasons.join(" · ")}
          </div>
        )}
      </button>

      {open && (
        <div id={panelId} className="mt-3 pt-3 border-t border-line/60">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3 mb-4">
            <Stat label="MODEL" value={drive.model ?? "—"} />
            <Stat label="SERIAL" value={drive.serial ?? "—"} />
            <Stat label="FIRMWARE" value={drive.firmware ?? "—"} />
            <Stat
              label="INTERFACE"
              value={
                drive.interfaceSpeed ??
                (drive.rpm != null ? `${drive.rpm.toLocaleString()} rpm` : BUS_LABEL[drive.bus])
              }
            />
            <Stat
              label="SELF-ASSESSMENT"
              value={drive.smartPassed == null ? "—" : drive.smartPassed ? "PASSED" : "FAILED"}
              intent={drive.smartPassed === false ? "bad" : "ok"}
            />
            <Stat label="POWER ON" value={formatHours(drive.powerOnHours)} />
            <Stat label="POWER CYCLES" value={formatCount(drive.powerCycles)} />
            <Stat
              label="UNSAFE SHUTDOWNS"
              value={formatCount(drive.unsafeShutdowns)}
              title="Power lost without a clean flush. Routine on a homelab; not a fault on its own."
            />
            {drive.mediaErrors != null && (
              <Stat
                label="MEDIA ERRORS"
                value={formatCount(drive.mediaErrors)}
                intent={drive.mediaErrors > 0 ? "bad" : "ok"}
                title="Unrecoverable data errors. Any nonzero value is serious."
              />
            )}
            {drive.errorLogEntries != null && (
              <Stat
                label="ERROR LOG"
                value={formatCount(drive.errorLogEntries)}
                title="Entries in the controller's error log. Routinely nonzero and usually benign."
              />
            )}
            {drive.bytesWritten != null && <Stat label="HOST WRITES" value={formatBytes(drive.bytesWritten, 1)} />}
            {drive.bytesRead != null && <Stat label="HOST READS" value={formatBytes(drive.bytesRead, 1)} />}
          </div>

          {spare && (
            <div className="mb-4">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="microlabel">SPARE BLOCKS</span>
                <span className="font-mono text-[0.7rem] text-ink-dim">
                  {spare.pct}% <span className="text-ink-faint">· fails below {spare.min}%</span>
                </span>
              </div>
              <div className="relative h-1.5 rounded-full bg-panel-2 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${spare.pct}%`,
                    background: spare.pct <= spare.min ? VERDICT_FILL.bad : spare.pct <= spare.min + 10 ? VERDICT_FILL.warn : "var(--color-accent-dim)",
                  }}
                />
                <div
                  className="absolute inset-y-0 w-px bg-bad/70"
                  style={{ left: `${spare.min}%` }}
                  aria-hidden
                />
              </div>
            </div>
          )}

          {drive.temps.length > 0 && (
            <div className="mb-4">
              <div className="microlabel mb-1.5">TEMPERATURE</div>
              <div className="space-y-1.5">
                {drive.temps.map((t) => {
                  const intent = tempIntent(t, drive.rotational);
                  const scale = t.criticalC ?? (drive.rotational ? 60 : 75);
                  const pct = Math.max(0, Math.min(100, (t.celsius / scale) * 100));
                  return (
                    <div key={t.label} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2">
                      <span className="microlabel truncate">{t.label}</span>
                      <div className="relative h-1.5 rounded-full bg-panel-2 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                          style={{ width: `${pct}%`, background: VERDICT_FILL[intent] }}
                        />
                      </div>
                      <span className={cn("font-mono text-[0.7rem] tabular-nums", VERDICT_TEXT[intent])}>
                        {t.celsius.toFixed(1)} °C
                        {t.criticalC != null && (
                          <span className="text-ink-faint"> / {t.criticalC.toFixed(0)}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {drive.ata.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="microlabel">SMART ATTRIBUTES</span>
                <span className="microlabel normal-case tracking-normal hidden sm:inline">
                  bar = headroom above the failure threshold · hatched = no threshold published
                </span>
              </div>
              <div className="divide-y divide-line/40">
                {drive.ata.map((a) => (
                  <AttributeGauge key={a.id} attr={a} />
                ))}
              </div>
            </div>
          )}

          {!drive.smartAvailable && drive.unavailableReason && (
            <div className="text-[0.7rem] text-ink-dim">
              {drive.unavailableReason}
              <div className="text-ink-faint mt-1">
                Cheap USB bridges do not pass SMART commands through. Capacity and usage are still real; health is not knowable.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── array + filesystem integrity ────────────────────────────────────────── */

function IntegritySection({ snap }: { snap: SmartSnapshot }) {
  const { integrity } = snap;
  const raid = integrity.mdArrays;
  const zfs = integrity.zfs;
  const btrfs = integrity.btrfs;

  return (
    <div className="mt-4 pt-3 border-t border-line">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <span className="microlabel">ARRAY INTEGRITY</span>
        {integrity.reasons.length > 0 && (
          <span className={cn("text-[0.7rem]", VERDICT_TEXT[integrity.verdict])}>
            {integrity.reasons.join(" · ")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3 mb-3">
        <div>
          <div className="microlabel">LVM</div>
          {integrity.lvm.length === 0 ? (
            <div className="font-mono text-xs text-ink-faint mt-0.5">none</div>
          ) : (
            integrity.lvm.map((g) => (
              <div key={g.dm} className="font-mono text-xs text-ink mt-0.5 truncate" title={`${g.name}/${g.lv} on ${g.pvs.join(", ")}`}>
                {g.name} <span className="text-ink-faint">← {g.pvs.join(", ") || "—"}</span>
              </div>
            ))
          )}
        </div>

        <div>
          <div className="microlabel">RAID</div>
          {raid.length === 0 ? (
            <div
              className="font-mono text-xs text-ink-faint mt-0.5"
              title={integrity.raidPersonalities.length > 0 ? `kernel supports: ${integrity.raidPersonalities.join(", ")}` : undefined}
            >
              none configured
            </div>
          ) : (
            raid.map((a) => (
              <div key={a.name} className={cn("font-mono text-xs mt-0.5", a.degraded ? "text-bad" : "text-ink")}>
                {a.name} {a.level} {a.activeDisks != null && `${a.activeDisks}/${a.totalDisks}`}
                {a.degraded && " DEGRADED"}
              </div>
            ))
          )}
        </div>

        <PoolCell state={zfs} label="ZFS" />
        <PoolCell state={btrfs} label="BTRFS" />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <span className="microlabel">FILESYSTEM ERRORS</span>
          {/* Explainer, not information — on a phone it wraps into a two-column
              collision with its own heading, so it waits for room. */}
          <span className="microlabel normal-case tracking-normal hidden sm:inline">
            kernel counters since last fsck
          </span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {integrity.filesystems.length === 0 ? (
            <span className="font-mono text-xs text-ink-faint">no ext4 filesystems reporting</span>
          ) : (
            integrity.filesystems.map((f) => (
              <div key={f.device} className="flex items-baseline gap-1.5">
                <span className="font-mono text-xs text-ink-dim" title={f.displayName}>
                  {f.mount ?? f.displayName}
                </span>
                <span className={cn("font-mono text-xs", f.errors > 0 ? "text-bad" : "text-ok")}>{f.errors}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** A volume manager that is simply not installed is a fact, not a fault — it must
 *  never render in an alarm colour. */
function PoolCell({ state, label }: { state: SmartSnapshot["integrity"]["zfs"]; label: string }) {
  return (
    <div>
      <div className="microlabel">{label}</div>
      {!state.present ? (
        <div className="font-mono text-xs text-ink-faint mt-0.5">not present</div>
      ) : state.pools.length === 0 ? (
        <div className="font-mono text-xs text-ink-dim mt-0.5">{state.note ?? "no pools"}</div>
      ) : (
        state.pools.map((p) => (
          <div key={p.name} className={cn("font-mono text-xs mt-0.5 truncate", p.degraded ? "text-bad" : "text-ink")}>
            {p.name} <span className={p.degraded ? "text-bad" : "text-ink-faint"}>{p.state}</span>
          </div>
        ))
      )}
    </div>
  );
}

/* ── panel ───────────────────────────────────────────────────────────────── */

export function DriveHealthPanel() {
  const { data, error, isLoading } = useSmart();

  // The one authored motion moment on this panel: every life track sweeps out
  // once, together, on first paint. Re-polls must not re-run it — a track that
  // re-animates every 30 s reads as a value that keeps changing.
  const [swept, setSwept] = useState(false);
  useEffect(() => {
    if (data && !swept) {
      const id = requestAnimationFrame(() => setSwept(true));
      return () => cancelAnimationFrame(id);
    }
  }, [data, swept]);

  const drives = useMemo(() => {
    if (!data?.drives) return [];
    // Worst first — the row you need is the row you see without scrolling.
    // `unknown` sorts LAST, not second: a USB stick whose bridge cannot pass SMART
    // through is not a problem, and ranking it above four healthy drives puts the
    // one row with nothing to say at the top of the card.
    const rank: Record<HealthVerdict, number> = { bad: 0, warn: 1, ok: 2, unknown: 3 };
    return [...data.drives].sort(
      (a, b) => rank[a.verdict] - rank[b.verdict] || a.name.localeCompare(b.name),
    );
  }, [data]);

  if (isLoading && !data) {
    return (
      <div className="panel p-4">
        <div className="microlabel mb-3">DRIVE HEALTH</div>
        <div className="text-xs text-ink-faint">Reading SMART data…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel p-4">
        <div className="microlabel mb-3">DRIVE HEALTH</div>
        <div className="text-xs text-bad">Could not load drive health.</div>
        <div className="text-[0.7rem] text-ink-faint mt-1">
          {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  // The collector republishes every 5 minutes; well past that means the timer is
  // dead and every figure below is a fossil. Say so rather than showing stale
  // numbers as if they were current.
  const stale = data.collectorAgeMs != null && data.collectorAgeMs > 20 * 60 * 1000;
  const verdictLine = headline(drives, data.overall);

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="microlabel">DRIVE HEALTH</span>
          <span className={cn("microlabel", VERDICT_TEXT_STRONG[verdictLine.tone])}>
            {verdictLine.text}
          </span>
        </div>
        {data.collectorTs != null && (
          <span
            className={cn("microlabel shrink-0", stale && "!text-warn")}
            title={stale ? "The host collector has not published recently — nightwatch-smart.timer may be stopped" : undefined}
          >
            {/* "CHECKED" earns its place: uppercased, "11m ago" and "11mo ago"
                are one letter apart, and the prefix makes the unit unambiguous. */}
            {stale ? "STALE · " : "CHECKED "}
            {relativeTime(data.collectorTs)}
          </span>
        )}
      </div>

      {data.error ? (
        <div className="text-xs text-ink-dim">
          {data.error}
          <div className="text-[0.7rem] text-ink-faint mt-1">
            SMART needs root and raw device access, so a host-side collector publishes it. Check{" "}
            <span className="font-mono">systemctl status nightwatch-smart.timer</span> on the host.
          </div>
        </div>
      ) : drives.length === 0 ? (
        <div className="text-xs text-ink-faint">No physical drives reported.</div>
      ) : (
        <div>
          {drives.map((d) => (
            <DriveRow key={d.device} drive={d} swept={swept} />
          ))}
        </div>
      )}

      <IntegritySection snap={data} />
    </div>
  );
}
