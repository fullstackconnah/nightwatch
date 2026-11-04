"use client";

import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import { ClimateDetail } from "@/components/smarthome/climate";
import { LightsDetail, SensorsDetail, SwitchesDetail } from "@/components/smarthome/devices";
import { LockActions, LockDetail } from "@/components/smarthome/lock";
import { PageHead } from "@/components/strips/page-head";
import { StripList, type StripSpec } from "@/components/strips/strip-list";
import { fetcher } from "@/lib/client";
import type { ClimateAutoOffServerState } from "@/lib/kiosk/use-climate-auto-off";
import { smarthomeModel, type StripId, type WriteId } from "@/lib/smarthome/page-model";
import { useHa } from "@/lib/use-ha";
import { useNow } from "@/lib/use-now";

export default function SmarthomePage() {
  const ha = useHa();
  // Read-only: the kiosk owns the schedule. A failed read just drops the auto-off words.
  const { data: autoOff } = useSWR<ClimateAutoOffServerState>("/kiosk/api/climate-auto-off", fetcher);
  const now = useNow(true);

  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  useEffect(() => {
    if (!ha.isValidating && !ha.error && ha.data) setLastOkAt(Date.now());
  }, [ha.isValidating, ha.error, ha.data]);
  const [lockBusy, setLockBusy] = useState(false);

  const model = smarthomeModel({ ha: ha.data, loadError: Boolean(ha.error), autoOff, lockBusy, lastOkAt, now });
  const on = (id: WriteId) => model.writes.find((w) => w.id === id)?.enabled ?? false;
  const e = ha.data?.status === "ok" ? ha.data.entities : undefined;

  const lead = (id: StripId, body: ReactNode) => (
    <>
      {model.autoTarget === id && model.detailLead && <p className="st-note">{model.detailLead}</p>}
      {body}
    </>
  );
  const oneLock = e?.locks.length === 1 ? e.locks[0] : null;
  const lockProps = e && { ha, entities: e, stale: model.stale, lockBusy, onPending: setLockBusy };

  const parts: Record<StripId, Pick<StripSpec, "slot" | "body">> | undefined = e && lockProps && {
    climate: { body: lead("climate", <ClimateDetail ha={ha} climates={e.climates} entities={e} stale={model.stale} />) },
    lock: {
      slot: oneLock ? <LockActions {...lockProps} lock={oneLock} /> : undefined,
      body: lead("lock", <LockDetail {...lockProps} inSlot={Boolean(oneLock)} />),
    },
    lights: { body: lead("lights", <LightsDetail ha={ha} entities={e} enabled={on("light-toggle")} />) },
    switches: { body: lead("switches", <SwitchesDetail ha={ha} entities={e} enabled={on("switch-toggle")} />) },
    sensors: { body: lead("sensors", <SensorsDetail sensors={e.sensors} />) },
  };
  const strips: StripSpec[] = parts ? model.strips.map((s) => ({ ...s, ...parts[s.id] })) : [];

  return (
    <div className="st-page pb-2">
      <PageHead title="Smart home" chip={model.chip} answer={model.answer} evidence={model.evidence} link={model.link} notice={model.notice} />
      {strips.length > 0 && <StripList strips={strips} autoTarget={model.autoTarget} />}
    </div>
  );
}
