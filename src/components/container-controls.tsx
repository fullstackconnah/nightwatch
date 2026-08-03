"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Pause, Play, RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/client";
import { formatUptime, relativeTime } from "@/lib/format";
import { TICKING_THRESHOLD_MS, useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

export type LifecycleAction = "start" | "stop" | "restart" | "pause" | "unpause";

/**
 * One definition of each verb — label, glyph, and how loudly it should present
 * itself when a surface has room to draw it as a named button. The overview
 * cards, the containers table and the detail header all read from here, which
 * is what stops "Stop" from being a red button on one screen and a grey one on
 * the next.
 *
 * "Resume" rather than "Unpause": the API verb is unpause, but nobody thinks of
 * it that way, and the button opposite Pause should be the word people expect.
 */
export const LIFECYCLE_META: Record<
  LifecycleAction,
  { label: string; Icon: typeof Play; variant: "default" | "outline" | "danger" }
> = {
  start: { label: "Start", Icon: Play, variant: "default" },
  unpause: { label: "Resume", Icon: Play, variant: "default" },
  restart: { label: "Restart", Icon: RotateCw, variant: "outline" },
  pause: { label: "Pause", Icon: Pause, variant: "outline" },
  stop: { label: "Stop", Icon: Square, variant: "danger" },
};

/**
 * Resting colour is uniform ink-dim for all five — a row of pre-tinted verbs
 * reads as a warning before anyone has decided to do anything. Intent shows up
 * on hover and focus, where it is about to matter.
 */
const ACTION_TONE: Record<LifecycleAction, string> = {
  start: "hover:text-ok focus-visible:text-ok",
  unpause: "hover:text-ok focus-visible:text-ok",
  restart: "hover:text-accent focus-visible:text-accent",
  pause: "hover:text-warn focus-visible:text-warn",
  stop: "hover:text-bad focus-visible:text-bad",
};

/**
 * The verbs the daemon will actually accept, per state.
 *
 * `restarting` gets only stop: a container in a crash-restart loop is asking to
 * be halted, and "restart the restarting thing" is not a coherent request.
 * `paused` deliberately omits restart — Docker would have to thaw it first, so
 * the honest two-step is resume, then restart.
 */
export function actionsFor(state: string): LifecycleAction[] {
  switch (state) {
    case "running":
      return ["restart", "pause", "stop"];
    case "paused":
      return ["unpause", "stop"];
    case "restarting":
      return ["stop"];
    case "removing":
      return [];
    default:
      // exited | created | dead
      return ["start"];
  }
}

export interface Lifecycle {
  pending: LifecycleAction | null;
  error: string | null;
  run: (action: LifecycleAction) => Promise<void>;
  dismissError: () => void;
}

/**
 * One lifecycle call in flight at a time, with the failure surfaced in the UI
 * rather than through `alert()` — a modal dialog for "container already
 * stopped" halts the whole page over something the next poll would have shown.
 */
export function useLifecycle(id: string, onDone?: () => void): Lifecycle {
  const [pending, setPending] = useState<LifecycleAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `stop` can take the full 15s SIGTERM grace period, which is ample time to
  // navigate away — hold onDone in a ref so a caller passing an inline arrow
  // doesn't re-create `run` on every render, and skip state writes if the
  // component went away while the request was outstanding.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (action: LifecycleAction) => {
      setPending(action);
      setError(null);
      try {
        await postJson(`/api/docker/containers/${id.slice(0, 12)}/action`, { action });
        doneRef.current?.();
      } catch (e) {
        if (mounted.current) {
          setError(e instanceof Error ? e.message : `${LIFECYCLE_META[action].label} failed`);
        }
      } finally {
        if (mounted.current) setPending(null);
      }
    },
    [id],
  );

  return { pending, error, run, dismissError: useCallback(() => setError(null), []) };
}

export function LifecycleActions({
  state,
  name,
  lifecycle,
  dense,
  touch,
  className,
}: {
  state: string;
  name: string;
  lifecycle: Lifecycle;
  /** Tighter targets on pointer devices only — touch keeps the full 40px. */
  dense?: boolean;
  /**
   * Kiosk wall surfaces opt into the 56px `touch` button size explicitly
   * (see ui/button.tsx) instead of the shared `icon` variant's desktop `md:`
   * density. `dense` and `touch` pull in opposite directions and are never
   * passed together — `dense` tightens for a mouse, `touch` guarantees the
   * kiosk's wall-tap floor regardless of viewport width.
   */
  touch?: boolean;
  className?: string;
}) {
  const actions = actionsFor(state);
  if (actions.length === 0) return null;
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {actions.map((action) => {
        const { label, Icon } = LIFECYCLE_META[action];
        const isPending = lifecycle.pending === action;
        return (
          <Button
            key={action}
            size={touch ? "touch" : "icon"}
            variant="ghost"
            className={cn(ACTION_TONE[action], dense && "md:h-7 md:w-7")}
            // Every button in the group locks while one is in flight: the
            // daemon rejects concurrent lifecycle calls on one container, and a
            // 409 the operator caused by double-clicking is not worth showing.
            disabled={lifecycle.pending !== null}
            aria-busy={isPending}
            aria-label={`${label} ${name}`}
            title={label}
            onClick={() => void lifecycle.run(action)}
          >
            <Icon
              size={13}
              className={cn(
                isPending && (action === "restart" ? "animate-spin" : "animate-pulse"),
              )}
            />
          </Button>
        );
      })}
    </div>
  );
}

export function OpenAppLink({
  url,
  name,
  dense,
  className,
}: {
  url: string;
  name: string;
  dense?: boolean;
  className?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${name}`}
      title={url}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-ink-dim transition",
        "hover:text-accent focus-visible:text-accent outline-none focus-visible:ring-1 focus-visible:ring-accent",
        dense ? "h-10 w-10 md:h-7 md:w-7" : "h-10 w-10 md:h-8 md:w-8",
        className,
      )}
    >
      <ExternalLink size={13} />
    </a>
  );
}

export interface StatusSource {
  state: string;
  health: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  restartCount: number;
}

/**
 * The card's one line of state, written in the register each state deserves:
 * a running container's state IS its uptime, so it says "up 4d 6h" rather than
 * repeating the word Running next to a green dot that already said it. Only
 * states that need explaining spell themselves out.
 */
export function ContainerStatus({ c, className }: { c: StatusSource; className?: string }) {
  // Docker keeps counting StartedAt through a pause — the process is frozen,
  // its clock is not — so a paused container reports both facts.
  const counting = c.state === "running" || c.state === "paused";
  const anchor = counting ? c.startedAt : null;
  const now = useNow(anchor !== null && Date.now() - anchor < TICKING_THRESHOLD_MS);
  const uptime = anchor === null ? null : formatUptime((now - anchor) / 1000);

  switch (c.state) {
    case "running":
      // Uptime is data, not a state indicator — the dot beside the name already
      // carries "running", and a green duration next to a green dot spends the
      // palette twice on one fact. Colour is kept for the states that want
      // someone's attention.
      return (
        <span className={cn("font-mono text-ink-dim", className)}>
          {c.health === "unhealthy" && <span className="text-warn">unhealthy · </span>}
          up {uptime ?? "—"}
        </span>
      );

    case "paused":
      return (
        <span className={cn("font-mono text-ink-dim", className)}>
          <span className="text-warn">paused</span>
          {uptime && <> · up {uptime}</>}
        </span>
      );

    case "restarting":
      return (
        <span className={cn("font-mono text-blue", className)}>
          restarting{c.restartCount > 0 && ` ×${c.restartCount}`}
        </span>
      );

    case "created":
      return <span className={cn("font-mono text-ink-dim", className)}>never started</span>;

    case "removing":
      return <span className={cn("font-mono text-ink-dim", className)}>removing</span>;

    case "dead":
      return <span className={cn("font-mono text-bad", className)}>dead</span>;

    default: {
      // exited, and anything Docker adds later that means "not running".
      //
      // 143 is 128+SIGTERM — what a container exits with when someone pressed
      // Stop and it shut down when asked. Reporting the operator's own
      // successful request in the same red as a crash is how you teach someone
      // to stop reading the colour. It is still shown, just not as an alarm.
      const code = c.exitCode;
      const clean = code == null || code === 0 || code === 143;
      return (
        <span className={cn("font-mono text-ink-dim", className)}>
          stopped{c.finishedAt ? ` ${relativeTime(c.finishedAt)}` : ""}
          {code != null && code !== 0 && (
            <span className={clean ? undefined : "text-bad"}> · exit {code}</span>
          )}
        </span>
      );
    }
  }
}

export interface PortMapping {
  private: number;
  public: number | null;
  type: string;
}

interface PublishedPort {
  host: number;
  targets: string[]; // e.g. ["53/tcp", "53/udp"]
}

/**
 * One entry per host port, not one per protocol binding.
 *
 * Pi-hole publishes 53 on both tcp and udp and qBittorrent publishes 6881 the
 * same way, so a naive render of Docker's port list prints ":53 :53" and
 * ":6881 :6881" — which reads as a duplicate-key bug rather than as the two
 * protocols it actually is. The protocols survive in the tooltip, where they
 * answer a question someone is deliberately asking.
 */
export function publishedPorts(ports: PortMapping[]): PublishedPort[] {
  const byHost = new Map<number, string[]>();
  for (const p of ports) {
    if (p.public == null) continue;
    const targets = byHost.get(p.public) ?? [];
    const target = `${p.private}/${p.type}`;
    if (!targets.includes(target)) targets.push(target);
    byHost.set(p.public, targets);
  }
  return [...byHost.entries()]
    .map(([host, targets]) => ({ host, targets }))
    .sort((a, b) => a.host - b.host);
}

function portTitle(p: PublishedPort): string {
  return `host ${p.host} → ${p.targets.join(", ")}`;
}

/**
 * Published host ports only. An unpublished port is a fact about the image, not
 * about how to reach this box, and host-network or `network_mode: service:...`
 * containers legitimately publish none — those render nothing rather than an
 * em dash, because there is no missing value to stand in for.
 */
export function PortChips({
  ports,
  max = 3,
  className,
}: {
  ports: PortMapping[];
  max?: number;
  className?: string;
}) {
  const published = publishedPorts(ports);
  if (published.length === 0) return null;
  const shown = published.slice(0, max);
  const rest = published.slice(max);

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-ink-dim", className)}>
      {/* One tone throughout, including the colon. A dimmer colon was prettier
          and put a glyph that is doing real work — it is what makes 8096 read
          as a port — at 2.9:1 on the panel, under the 4.5:1 floor. Same for the
          overflow count, which carries the fact that there are more. */}
      {shown.map((p) => (
        <span key={p.host} title={portTitle(p)}>
          :{p.host}
        </span>
      ))}
      {rest.length > 0 && (
        <span title={rest.map(portTitle).join("\n")}>+{rest.length}</span>
      )}
    </span>
  );
}

/** Inline, dismissible, and it never moves the card it belongs to off the grid. */
export function LifecycleError({ lifecycle, className }: { lifecycle: Lifecycle; className?: string }) {
  if (!lifecycle.error) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 text-[0.68rem] leading-snug text-bad",
        className,
      )}
    >
      <span className="min-w-0 flex-1 break-words">{lifecycle.error}</span>
      <button
        type="button"
        onClick={lifecycle.dismissError}
        aria-label="Dismiss error"
        className="shrink-0 text-ink-dim hover:text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent rounded px-1"
      >
        ×
      </button>
    </div>
  );
}
