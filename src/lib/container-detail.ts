import type { ContainerInspectInfo } from "dockerode";

// Labels are not sent: the page never reads them and they can hold proxy rules or credentials.
export function shapeContainerDetail(info: ContainerInspectInfo) {
  return {
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
    cmd: (info.Config.Cmd || []).join(" "),
    tty: info.Config.Tty,
  };
}
