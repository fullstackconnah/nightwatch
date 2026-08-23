"use client";

/* THESIS: the app's first autonomous HA-writer. Every performHaAction call
 * before this one was user-tap-triggered; this hook fires ONE off-volley
 * per night from the always-open kiosk tab (spec: no server daemon, the
 * tab IS the scheduler). One volley, never a converge-loop — these IR
 * units take up to ~7.6s to report a write back (climate-controls.ts's
 * measurements), and a human who turns an AC back ON after the sweep must
 * be respected until tomorrow. lastRunDate/skipDate live server-side so a
 * reload or a second kiosk can't double-fire; set_hvac_mode "off" is
 * idempotent anyway, so the worst race is a harmless duplicate. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher, postJson } from "@/lib/client";
import {
  shouldFire,
  statusFor,
  warnWindow,
  type AutoOffStatus,
  type ClimateAutoOffConfig,
  type ClimateAutoOffPatch,
  type SweepWindow,
} from "@/lib/climate-auto-off";
import type { UseKioskHaResult } from "@/components/kiosk/kiosk-hub";

const CONFIG_KEY = "/kiosk/api/climate-auto-off";
/** Engine tick + config re-read cadence. 30s is fine-grained enough for a
 *  5-minute warn lead and a 60-minute fire window, and cheap enough to run
 *  all day (the config GET is a local file read server-side). */
const TICK_MS = 30_000;
/** Retry budget when HA is unreachable at fire time: one attempt per tick,
 *  20 ticks ≈ 10 minutes (spec), then give up loudly-but-quietly. */
const MAX_FIRE_ATTEMPTS = 20;

export interface ClimateAutoOffServerState {
  enabled: boolean;
  time: string;
  skipDate: string | null;
  lastRunDate: string | null;
}

export interface UseClimateAutoOffResult {
  state: ClimateAutoOffServerState | undefined;
  status: AutoOffStatus | null;
  warn: SweepWindow | null;
  onCount: number;
  notice: string | null;
  saving: boolean;
  update: (patch: ClimateAutoOffPatch) => Promise<boolean>;
  skipTonight: () => Promise<boolean>;
}

function toConfig(state: ClimateAutoOffServerState): ClimateAutoOffConfig {
  return {
    enabled: state.enabled,
    time: state.time,
    skipDate: state.skipDate ?? undefined,
    lastRunDate: state.lastRunDate ?? undefined,
  };
}

export function useClimateAutoOff(ha: UseKioskHaResult): UseClimateAutoOffResult {
  const { data: state, mutate } = useSWR<ClimateAutoOffServerState>(CONFIG_KEY, fetcher, {
    refreshInterval: TICK_MS,
    keepPreviousData: true,
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const attemptsRef = useRef(0);

  const entities = ha.data?.entities;
  const onCount = useMemo(
    () => entities?.climates.filter((c) => c.hvacMode !== "off").length ?? 0,
    [entities],
  );

  // Latest-value refs for `entities`/`ha`, kept current every render but
  // deliberately NOT in the fire effect's deps (see below) — reading them
  // fresh inside the effect body without retriggering on their churn.
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const haRef = useRef(ha);
  haRef.current = ha;

  /* The engine: evaluated on every tick and on every config change — NOT on
   * HA-data churn. `entities`/`ha` are read via refs (above) so a live HA
   * poll (7-20s cadence, and `ha` itself changes identity on every poll
   * because runAction's deps include `data`) can't retrigger this effect
   * mid-retry-sequence; without that, "one attempt per tick" (20 ticks ≈ 10
   * minutes, see MAX_FIRE_ATTEMPTS) would actually burn out in ~2-3 minutes.
   * busyRef makes the volley single-flight; a FAILED volley leaves
   * lastRunDate unset so the next tick retries (against the then-current
   * on-list — units that did turn off drop out naturally), bounded by
   * MAX_FIRE_ATTEMPTS. */
  useEffect(() => {
    if (!state || busyRef.current) return;
    const win = shouldFire(toConfig(state), new Date(nowMs));
    if (!win) return;

    busyRef.current = true;
    void (async () => {
      try {
        const entities = entitiesRef.current;
        const ha = haRef.current;
        if (!entities) {
          // HA states unavailable (unreachable/unconfigured) — counts as a
          // failed attempt; the volley can't even be aimed yet.
          attemptsRef.current += 1;
        } else {
          const on = entities.climates.filter((c) => c.hvacMode !== "off");
          let allOk = true;
          // Cumulative optimistic entities: each confirmed send flips its
          // tile immediately, same feel as a manual tap.
          let optimistic = entities;
          for (const c of on) {
            optimistic = {
              ...optimistic,
              climates: optimistic.climates.map((x) =>
                x.entityId === c.entityId ? { ...x, hvacMode: "off" } : x,
              ),
            };
            const ok = await ha.runAction(
              { entityId: c.entityId, action: "set_hvac_mode", hvacMode: "off" },
              optimistic,
            );
            if (!ok) allOk = false;
          }
          if (allOk) {
            try {
              await postJson(CONFIG_KEY, { lastRunDate: win.dateKey });
              attemptsRef.current = 0;
              setNotice(null);
              await mutate();
              return;
            } catch {
              // Volley itself succeeded but the completion-marker POST
              // didn't land — treat it as a failed attempt so a persistently
              // failing marker POST still exhausts the retry budget and
              // reaches the give-up path below (which has its own .catch),
              // instead of silently re-running the full volley every tick.
              attemptsRef.current += 1;
            }
          } else {
            attemptsRef.current += 1;
          }
        }
        if (attemptsRef.current >= MAX_FIRE_ATTEMPTS) {
          // Close the window server-side even on failure — without this the
          // engine would re-volley every tick for the rest of the hour,
          // fighting a human who turned a unit back on mid-outage.
          await postJson(CONFIG_KEY, { lastRunDate: win.dateKey }).catch(() => {});
          setNotice("Auto-off couldn't reach every AC tonight — check Home Assistant.");
          attemptsRef.current = 0;
          await mutate();
        }
      } finally {
        busyRef.current = false;
      }
    })();
  }, [nowMs, state, mutate]);

  const update = useCallback(
    async (patch: ClimateAutoOffPatch) => {
      setSaving(true);
      try {
        await postJson(CONFIG_KEY, patch);
        await mutate();
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [mutate],
  );

  const status = state ? statusFor(toConfig(state), new Date(nowMs)) : null;
  const warn = state ? warnWindow(toConfig(state), new Date(nowMs)) : null;

  const skipTonight = useCallback(async () => {
    // The skip target is whichever window the user is being warned about /
    // is scheduled next; statusFor carries it for both cases.
    const target =
      warn ??
      (status && (status.kind === "scheduled" || status.kind === "skipped") ? status.window : null);
    if (!target) return false;
    return update({ skipDate: target.dateKey });
  }, [warn, status, update]);

  return useMemo(
    () => ({ state, status, warn, onCount, notice, saving, update, skipTonight }),
    [state, status, warn, onCount, notice, saving, update, skipTonight],
  );
}
