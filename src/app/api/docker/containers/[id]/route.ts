import { NextRequest, NextResponse } from "next/server";
import { docker } from "@/lib/docker";

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
