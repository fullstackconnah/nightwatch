import { NextRequest, NextResponse } from "next/server";
import { hostname } from "node:os";
import { docker, listContainers, removeContainer } from "@/lib/docker";
import { isContainerId } from "@/lib/container-id";
import { removeDecision, removeErrorCopy } from "@/lib/container-remove";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const info = await docker.getContainer(id).inspect();
    return NextResponse.json({
      id: info.Id,
      name: info.Name.replace(/^\//, ""),
      image: info.Config.Image,
      created: info.Created,
      state: {
        status: info.State.Status,
        running: info.State.Running,
        startedAt: info.State.StartedAt,
        exitCode: info.State.ExitCode,
        health: info.State.Health?.Status ?? null,
        restartCount: info.RestartCount,
        oomKilled: info.State.OOMKilled,
      },
      restartPolicy: info.HostConfig.RestartPolicy?.Name ?? "no",
      networkMode: info.HostConfig.NetworkMode,
      composeProject: info.Config.Labels?.["com.docker.compose.project"] ?? null,
      composeService: info.Config.Labels?.["com.docker.compose.service"] ?? null,
      ports: Object.entries(info.NetworkSettings.Ports || {}).map(([key, bindings]) => ({
        container: key,
        host: (bindings || []).map((b) => `${b.HostIp}:${b.HostPort}`),
      })),
      mounts: (info.Mounts || []).map((m) => ({
        source: (m as { Source?: string }).Source ?? (m as { Name?: string }).Name ?? "",
        destination: m.Destination,
        rw: m.RW,
        type: m.Type,
      })),
      env: info.Config.Env || [],
      labels: info.Config.Labels || {},
      cmd: (info.Config.Cmd || []).join(" "),
      tty: info.Config.Tty,
    });
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode === 404 ? 404 : 502;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "inspect failed" },
      { status },
    );
  }
}

/** Removes a stopped container. Never forces and never drops volumes (REMOVE_OPTIONS). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isContainerId(id)) return NextResponse.json({ error: "invalid container id" }, { status: 400 });
  // Fresh read: the state and protection checks must see the container as it is now, not 2 s ago.
  const all = await listContainers(true).catch(() => null);
  const decision = removeDecision(all, id, hostname());
  if (!("ok" in decision)) return NextResponse.json({ error: decision.message }, { status: decision.status });
  const { target } = decision;
  try {
    await removeContainer(target.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 403 || status === 404 || status === 409) {
      return NextResponse.json({ error: removeErrorCopy(status, target.name) }, { status });
    }
    if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ECONNRESET/.test(message)) {
      return NextResponse.json({ error: removeErrorCopy("ECONN", target.name, message) }, { status: 502 });
    }
    return NextResponse.json({ error: removeErrorCopy(500, target.name, message) }, { status: 500 });
  }
}
