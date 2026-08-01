"use client";

/* THESIS: subject-first, same ordering /smarthome and /proxy use — status
   band (is it alive, what's it running) above the two things you might
   actually do (trigger a run, ask it something) above the log of what it's
   already done. Status and activity poll independently (10s / 30s) because
   they change on different clocks; actions/ask each own their own job slot.
   OWN-WORLD: nightwatch console — hairline .panel, teal accent, mono
   numerals, microlabels; no chart library, no raw hex, no colour without a
   threshold behind it. */

import { useHermesActivity, useHermesStatus } from "@/lib/use-hermes";
import {
  HermesLoadError,
  HermesSkeleton,
  HermesUnauthorized,
  HermesUnconfigured,
  HermesUnreachable,
} from "@/components/hermes-status";
import { HermesStatusBand } from "@/components/hermes-status-band";
import { HermesActionsRow } from "@/components/hermes-actions";
import { HermesAsk } from "@/components/hermes-ask";
import { HermesActivityFeed } from "@/components/hermes-activity";

export default function HermesPage() {
  const { data, error, isLoading } = useHermesStatus();
  const { data: activity } = useHermesActivity();

  return (
    <div className="space-y-5 pb-2">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Hermes</h1>
          <p className="mt-0.5 text-xs text-ink-dim">ops daemon — status, digests, alerts, ask</p>
        </div>
        {data?.status === "ok" && (
          <div className="flex items-center gap-2">
            <span className={data.ok ? "dot dot-running" : "dot dot-unhealthy"} aria-hidden />
            <span className="microlabel">{data.ok ? "connected" : "reporting unhealthy"}</span>
          </div>
        )}
      </header>

      {Boolean(error) && !data && <HermesLoadError error={error} />}

      {isLoading && !data && <HermesSkeleton />}

      {data?.status === "unconfigured" && <HermesUnconfigured />}
      {data?.status === "unreachable" && <HermesUnreachable detail={data.detail} />}
      {data?.status === "unauthorized" && <HermesUnauthorized detail={data.detail} />}

      {data?.status === "ok" && (
        <div className="space-y-5">
          <HermesStatusBand status={data} />
          <HermesActionsRow />
          <HermesAsk tier={data.tier.tier} />
          <HermesActivityFeed items={activity?.status === "ok" ? activity.items : []} />
        </div>
      )}
    </div>
  );
}
