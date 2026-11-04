/**
 * The Server strip's two parts: the slot (its main write, Stop or Start, always in the strip head) and the detail (what
 * the answer says in full, the pack facts, and Restart). Both use the strips pattern's one write idiom.
 */
"use client";

import { ConfirmStop } from "@/components/resources/container-controls";
import { WriteAction } from "@/components/strips/write-action";
import { Badge } from "@/components/ui/badge";
import { postJson, type MinecraftStatusResponse } from "@/lib/client";
import type { Model } from "@/lib/minecraft/page-model";

const SOURCE_VARIANT = { curseforge: "accent", modrinth: "blue", upload: "neutral" } as const;

interface Target {
  id: string;
  name: string;
}

const act = (c: Target, action: "stop" | "start" | "restart") => async () => {
  await postJson(`/api/docker/containers/${c.id.slice(0, 12)}/action`, { action });
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
  onPending,
}: {
  model: Model;
  container: Target | undefined;
  online: number;
  crashed: boolean;
  onPending?: (p: boolean) => void;
}) {
  if (!container) return null;
  const stop = writeOf(model, "stop");
  const start = writeOf(model, "start");
  if (stop?.enabled) {
    const say =
      online > 0
        ? `Stops the server and disconnects ${players(online)}. Start it again from here.`
        : "Stops the server. Nobody is online. Start it again from here.";
    return (
      <WriteAction
        label="Stop"
        ariaLabel={`Stop ${container.name}`}
        flight="Stopping…"
        failure="Couldn’t stop the server"
        run={act(container, "stop")}
        onPending={onPending}
        renderAsk={({ onYes, onCancel }) => <ConfirmStop name={container.name} say={say} onYes={onYes} onCancel={onCancel} />}
      />
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
        run={act(container, "start")}
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
  onPending,
}: {
  model: Model;
  status: MinecraftStatusResponse | undefined;
  container: Target | undefined;
  online: number;
  installFailed: boolean;
  onPending?: (p: boolean) => void;
}) {
  const active = status?.instances.find((i) => i.slug === status.active);
  const restart = writeOf(model, "restart");
  return (
    <div className="st-stack">
      {model.detailLead && <p className="text-sm text-ink">{model.detailLead}</p>}
      {active ? (
        <div className="st-row">
          <span className="text-sm text-ink font-medium">{active.name}</span>
          <Badge variant={SOURCE_VARIANT[active.source]}>{active.source}</Badge>
          <Badge variant="neutral">{active.mcVersion || "—"}</Badge>
          <Badge variant="neutral">{active.memoryGb} GB</Badge>
        </div>
      ) : (
        <p className="st-note">No pack active. Pick one in the Pack strip.</p>
      )}
      {installFailed && <p className="st-note">Some files need manual download. Open the Log strip to see which.</p>}
      {container && restart?.enabled && (
        <div>
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
            run={act(container, "restart")}
            onPending={onPending}
          />
        </div>
      )}
    </div>
  );
}
