/**
 * The Server strip's two parts: the slot (its main write, Stop or Start, always in the strip head) and the detail (what
 * the answer says in full, the pack facts, and Restart). Both use the strips pattern's one write idiom.
 */
"use client";

import { ConfirmStop } from "@/components/resources/container-controls";
import { WriteAction } from "@/components/strips/write-action";
import { Badge } from "@/components/ui/badge";
import { postJson, type MinecraftStatusResponse } from "@/lib/client";
import { leadFor, noPackNote, type Model } from "@/lib/minecraft/page-model";

const SOURCE_VARIANT = { curseforge: "accent", modrinth: "blue", upload: "neutral" } as const;

interface Target {
  id: string;
  name: string;
}

const act = (c: Target, action: "stop" | "start" | "restart" | "pause" | "unpause", refresh?: () => Promise<unknown> | void) => async () => {
  await postJson(`/api/docker/containers/${c.id.slice(0, 12)}/action`, { action });
  await refresh?.();
};

const players = (n: number) => `${n} player${n === 1 ? "" : "s"}`;

function writeOf(model: Model, id: Model["writes"][number]["id"]) {
  return model.writes.find((w) => w.id === id);
}

export function ServerSlot({
  model,
  container,
  online,
  crashed,
  busy,
  onPending,
  refresh,
}: {
  model: Model;
  container: Target | undefined;
  online: number;
  crashed: boolean;
  /** Another Server write is in flight: the daemon rejects concurrent lifecycle calls. */
  busy?: boolean;
  onPending?: (p: boolean) => void;
  refresh?: () => Promise<unknown> | void;
}) {
  if (!container) return null;
  const stop = writeOf(model, "stop");
  const start = writeOf(model, "start");
  const resume = writeOf(model, "resume");
  if (stop?.enabled) {
    const say =
      online > 0
        ? `Stops the server and disconnects ${players(online)}. Start it again from here.`
        : "Stops the server. Nobody is online. Start it again from here.";
    const stopAction = (
      <WriteAction
        label="Stop"
        ariaLabel={`Stop ${container.name}`}
        flight="Stopping…"
        failure="Couldn’t stop the server"
        disabled={busy}
        run={act(container, "stop", refresh)}
        onPending={onPending}
        renderAsk={({ onYes, onCancel }) => <ConfirmStop name={container.name} say={say} onYes={onYes} onCancel={onCancel} />}
      />
    );
    // Paused: Resume (harmless, no question) sits beside Stop.
    return resume?.enabled ? (
      <div className="st-row">
        <WriteAction
          label="Resume"
          ariaLabel={`Resume ${container.name}`}
          confirm={false}
          flight="Resuming…"
          failure="Couldn’t resume the server"
          disabled={busy}
          run={act(container, "unpause", refresh)}
          onPending={onPending}
        />
        {stopAction}
      </div>
    ) : (
      stopAction
    );
  }
  if (start?.enabled) {
    return (
      <WriteAction
        label={crashed ? "Start again" : "Start"}
        primary
        confirm={false}
        flight="Starting… first boot can take several minutes."
        failure="Couldn’t start the server"
        disabled={busy}
        run={act(container, "start", refresh)}
        onPending={onPending}
      />
    );
  }
  return null;
}

export function ServerDetail({
  model,
  status,
  container,
  online,
  installFailed,
  busy,
  onPending,
  refresh,
}: {
  model: Model;
  status: MinecraftStatusResponse | undefined;
  container: Target | undefined;
  online: number;
  installFailed: boolean;
  busy?: boolean;
  onPending?: (p: boolean) => void;
  refresh?: () => Promise<unknown> | void;
}) {
  const active = status?.instances.find((i) => i.slug === status.active);
  const restart = writeOf(model, "restart");
  const pause = writeOf(model, "pause");
  const lead = leadFor(model, "server");
  return (
    <div className="st-stack">
      {lead && <p className="text-sm text-ink">{lead}</p>}
      {active ? (
        <div className="st-row">
          <span className="text-sm text-ink font-medium">{active.name}</span>
          <Badge variant={SOURCE_VARIANT[active.source]}>{active.source}</Badge>
          <Badge variant="neutral">{active.mcVersion || "—"}</Badge>
          <Badge variant="neutral">{active.memoryGb} GB</Badge>
        </div>
      ) : (
        noPackNote(status) && <p className="st-note">{noPackNote(status)}</p>
      )}
      {installFailed && <p className="st-note">Some files need manual download. Open the Log strip to see which.</p>}
      {container && restart?.enabled && (
        <div className="st-row">
          <WriteAction
            label="Restart"
            say={
              online > 0
                ? `Restarts the server. ${players(online)} ${online === 1 ? "is" : "are"} disconnected for a minute or two.`
                : "Restarts the server. It is back in a minute or two."
            }
            yes="Yes, restart"
            flight="Restarting…"
            failure="Couldn’t restart the server"
            disabled={busy}
            run={act(container, "restart", refresh)}
            onPending={onPending}
          />
          {pause?.enabled && (
            <WriteAction
              label="Pause"
              confirm={false}
              flight="Pausing…"
              failure="Couldn’t pause the server"
              disabled={busy}
              run={act(container, "pause", refresh)}
              onPending={onPending}
            />
          )}
        </div>
      )}
    </div>
  );
}
