"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BackupNowSlot, BackupsDetail } from "@/components/minecraft/backups-panel";
import { Console } from "@/components/minecraft/console";
import { LogDetail, lastLogLine, useMinecraftLog } from "@/components/minecraft/log-detail";
import { PackBrowser } from "@/components/minecraft/pack-browser";
import { ServerDetail, ServerSlot } from "@/components/minecraft/status-card";
import { PageHead } from "@/components/strips/page-head";
import { StripList, useHeldList, type StripSpec } from "@/components/strips/strip-list";
import { buttonVariants } from "@/components/ui/button";
import { useContainers, useMinecraftBackups, useMinecraftStatus } from "@/lib/client";
import { leadFor, minecraftModel, type StripId } from "@/lib/minecraft/page-model";
import { useNow } from "@/lib/use-now";

/** Players: names only. While the strips are held (pointer or focus inside) rows stay put; a name that left reads "left" and new names wait behind "N new · show" (R5). */
function PlayersDetail({ names, stopped }: { names: string[]; stopped: boolean }) {
  const h = useHeldList(names);
  if (names.length === 0 && h.rows.length === 0) {
    return <p className="st-note">{stopped ? "The server is stopped, so nobody is online." : "Nobody is online."}</p>;
  }
  return (
    <div>
      <div className="st-listhead">
        <span>{names.length} online</span>
        <button type="button" className="st-pill" style={{ visibility: h.pill ? "visible" : "hidden" }} tabIndex={h.pill ? 0 : -1} onClick={h.show}>
          {h.pill || "0 new · show"}
        </button>
      </div>
      {h.rows.map((n) => (
        <div key={n} className="st-li" data-row-id={n} data-gone={h.gone.has(n) || !names.includes(n) ? "" : undefined}>
          <span className="st-grow text-sm">{n}</span>
          {(h.gone.has(n) || !names.includes(n)) && <span className="text-xs">left</span>}
        </div>
      ))}
    </div>
  );
}

export default function MinecraftPage() {
  const { data: status, error, mutate, isValidating } = useMinecraftStatus();
  const { data: containersData, mutate: mutateContainers } = useContainers();
  const { data: backupData, error: backupError, isLoading: backupsLoading, mutate: mutateBackups } = useMinecraftBackups();
  const container = containersData?.containers.find((c) => c.name === "minecraft");
  const now = useNow(true);

  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  useEffect(() => {
    if (!isValidating && !error && status) setLastOkAt(Date.now());
  }, [isValidating, error, status]);

  const [tail, setTail] = useState(200);
  const [paused, setPaused] = useState(false);
  const log = useMinecraftLog(container?.id, tail, paused);
  const lastLine = lastLogLine(log.data?.logs);

  const model = minecraftModel({
    status,
    statusError: Boolean(error),
    container: container && { state: container.state, exitCode: container.exitCode, startedAt: container.startedAt },
    containersReady: Boolean(containersData),
    backups: backupData?.backups,
    backupsError: Boolean(backupError),
    lastLine,
    lastOkAt,
    now,
  });

  const refresh = () => {
    void mutate();
    void mutateContainers();
  };
  const enabled = (id: (typeof model.writes)[number]["id"]) => model.writes.find((w) => w.id === id)?.enabled ?? false;
  const writesOff = !enabled("switch");
  const active = status?.instances.find((i) => i.slug === status.active);
  const cleanExit = container?.exitCode == null || container.exitCode === 0 || container.exitCode === 143;
  const exited = container?.state === "exited";
  const crashed = Boolean(active) && exited && !cleanExit;
  const online = status?.players?.online ?? 0;
  const target = container && { id: container.id, name: container.name };

  const parts: Record<StripId, Pick<StripSpec, "slot" | "body" | "mono">> = {
    server: {
      slot: <ServerSlot model={model} container={target} online={online} crashed={crashed} />,
      body: <ServerDetail model={model} status={status} container={target} online={online} installFailed={crashed} />,
    },
    players: { body: <PlayersDetail names={status?.players?.players ?? []} stopped={container?.state !== "running"} /> },
    pack: {
      body: status ? (
        <PackBrowser instances={status.instances} active={status.active} onChanged={refresh} disabled={writesOff} lead={leadFor(model, "pack")} />
      ) : null,
    },
    backups: {
      slot: (
        <BackupNowSlot
          enabled={enabled("backup-run")}
          describedBy="mc-backup-reason"
          onChanged={() => mutateBackups()}
        />
      ),
      body: (
        <BackupsDetail
          backups={backupData?.backups}
          error={Boolean(backupError)}
          loading={backupsLoading}
          containerState={container?.state}
          writesOff={!enabled("restore")}
          onChanged={() => mutateBackups()}
        />
      ),
    },
    console: { body: status ? <Console rcon={status.rcon} stale={!enabled("console-send") && status.rcon === "ok"} /> : null },
    log: {
      mono: true,
      slot: container ? (
        <Link href={`/logs?c=${encodeURIComponent(container.name)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open in Logs
        </Link>
      ) : undefined,
      body: (
        <LogDetail
          logs={log.data?.logs}
          error={Boolean(log.error)}
          tail={tail}
          paused={paused}
          onTail={setTail}
          onPaused={setPaused}
        />
      ),
    },
  };
  const strips: StripSpec[] = model.strips.map((s) => ({ ...s, ...parts[s.id] }));

  return (
    <div className="st-page pb-2">
      <PageHead title="Minecraft" chip={model.chip} answer={model.answer} evidence={model.evidence} link={model.link} notice={model.notice} />
      {strips.length > 0 && <StripList strips={strips} autoTarget={model.autoTarget} />}
    </div>
  );
}
