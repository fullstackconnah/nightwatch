"use client";

/**
 * /smarthome's client hook: polls GET /api/ha/states (SWR's default
 * `refreshWhenHidden: false` already stops the ~3s poll once the tab is
 * backgrounded, so there's nothing extra to wire for "while visible") and
 * exposes one `runAction` entry point every domain component (ha-lights.tsx,
 * ha-switches.tsx, ha-climate.tsx, ha-locks.tsx) calls through.
 *
 * Optimistic-update contract: the caller computes what the entity list
 * SHOULD look like after the toggle/nudge (e.g. flip `on`, without waiting
 * for HA), `runAction` swaps that into the SWR cache immediately, then fires
 * the POST. Success does nothing further — the poll already in flight
 * reconciles the real value within ~3s, so a confirmed toggle never visibly
 * snaps twice. Failure rolls the cache back to the last known-good snapshot
 * and records a per-entity error the row can render inline.
 */

import { useCallback, useState } from "react";
import useSWR from "swr";
import { ApiError, fetcher, postJson } from "@/lib/client";
import type { HaActionRequest, HaEntities, HaStatesResponse } from "@/lib/ha-types";

const HA_STATES_KEY = "/api/ha/states";

export interface UseHaResult {
  data: HaStatesResponse | undefined;
  error: unknown;
  isLoading: boolean;
  runAction: (req: HaActionRequest, optimisticEntities: HaEntities) => Promise<void>;
  /** entityId -> most recent action failure message for that entity. */
  actionErrors: Record<string, string>;
  dismissActionError: (entityId: string) => void;
}

export function useHa(refreshMs = 3000): UseHaResult {
  const { data, error, isLoading, mutate } = useSWR<HaStatesResponse>(HA_STATES_KEY, fetcher, {
    refreshInterval: refreshMs,
    keepPreviousData: true,
  });

  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const dismissActionError = useCallback((entityId: string) => {
    setActionErrors((prev) => {
      if (!(entityId in prev)) return prev;
      const next = { ...prev };
      delete next[entityId];
      return next;
    });
  }, []);

  const runAction = useCallback(
    async (req: HaActionRequest, optimisticEntities: HaEntities) => {
      const previous = data;
      dismissActionError(req.entityId);

      if (previous?.status === "ok") {
        await mutate({ ...previous, entities: optimisticEntities }, { revalidate: false });
      }

      try {
        await postJson("/api/ha/action", req);
      } catch (e) {
        if (previous) await mutate(previous, { revalidate: false });
        const message =
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Action failed — try again.";
        setActionErrors((prev) => ({ ...prev, [req.entityId]: message }));
      }
    },
    [data, mutate, dismissActionError],
  );

  return { data, error, isLoading, runAction, actionErrors, dismissActionError };
}
