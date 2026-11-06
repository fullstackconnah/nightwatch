"use client";

/* THESIS: the strips pattern on /hermes. A pure hermesModel() answers "is Hermes alive, are its loops working, what did
   it last say" and picks the strip the answer names; four fixed strips (Loops, Runs, Ask, Activity) hold what used to be
   four stacked panels. The page owns the one Hermes job slot (the daemon runs one job at a time) and passes it to Runs
   and Ask. OWN-WORLD: nightwatch console — the pattern's .st-* classes, house Badge and Button, no new token. */

import { useEffect, useState, type ReactNode } from "react";
import { HermesActivityFeed } from "@/components/integrations/hermes-activity";
import { RunDigest, RunsDetail, WHY_ID } from "@/components/integrations/hermes-actions";
import { HermesAsk } from "@/components/integrations/hermes-ask";
import { HermesStatusBand } from "@/components/integrations/hermes-status-band";
import { PageHead } from "@/components/strips/page-head";
import { StripList, type StripSpec } from "@/components/strips/strip-list";
import { hermesModel, type StripId, type WriteId } from "@/lib/hermes/page-model";
import { useHermesActivity, useHermesRun, useHermesStatus } from "@/lib/use-hermes";
import { useNow } from "@/lib/use-now";

export default function HermesPage() {
  const status = useHermesStatus();
  const { data: activity } = useHermesActivity();
  const run = useHermesRun();
  const now = useNow(true);

  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  useEffect(() => {
    if (!status.isValidating && !status.error && status.data) setLastOkAt(Date.now());
  }, [status.isValidating, status.error, status.data]);

  const model = hermesModel({ status: status.data, activity, loadError: Boolean(status.error), run, lastOkAt, now });
  const write = (id: WriteId) => model.writes.find((w) => w.id === id)!;
  const ok = status.data?.status === "ok" ? status.data : undefined;

  const lead = (id: StripId, body: ReactNode) => (
    <>
      {model.autoTarget === id && model.detailLead && <p className="st-note mb-3">{model.detailLead}</p>}
      {body}
    </>
  );
  // The stale notice already says why; the one-job reason only shows when it is the news.
  const why = write("test-alert").reason;
  const reason = model.stale ? null : why;
  const askReason = model.stale ? null : write("ask").reason;

  const parts: Record<StripId, Pick<StripSpec, "slot" | "body">> | undefined = ok && {
    loops: { body: lead("loops", <HermesStatusBand status={ok} />) },
    runs: {
      slot: <RunDigest run={run} enabled={write("run-digest").enabled} />,
      body: lead("runs", <RunsDetail run={run} enabled={write("test-alert").enabled} reason={reason} />),
    },
    ask: { body: lead("ask", <HermesAsk tier={ok.tier.tier} run={run} enabled={write("ask").enabled} reason={askReason} />) },
    activity: { body: lead("activity", <HermesActivityFeed items={activity?.status === "ok" ? activity.items : []} />) },
  };
  const strips: StripSpec[] = parts ? model.strips.map((s) => ({ ...s, ...parts[s.id] })) : [];

  return (
    <div className="st-page pb-2">
      <PageHead title="Hermes" chip={model.chip} answer={model.answer} evidence={model.evidence} link={model.link} notice={model.notice} />
      {why && <span id={WHY_ID} className="sr-only">{why}</span>}
      {strips.length > 0 && <StripList strips={strips} autoTarget={model.autoTarget} />}
    </div>
  );
}
