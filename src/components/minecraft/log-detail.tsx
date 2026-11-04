/**
 * The Log strip: the minecraft container's recent output, polled every 5 s. The page owns the hook so the strip's state
 * line can quote the last line; this part is the detail (tail length, pause, the box). Pause is a view toggle, not a
 * write, so it stays on when the server is stale.
 */
"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { fetcher } from "@/lib/client";

export const TAILS = [100, 200, 500, 1000, 5000] as const;

export function useMinecraftLog(id: string | undefined, tail: number, paused: boolean) {
  return useSWR<{ logs: string }>(
    id && !paused ? `/api/docker/containers/${id}/logs?tail=${tail}` : null,
    fetcher,
    { refreshInterval: 5000, keepPreviousData: true },
  );
}

/** The last non-empty line, trimmed for a one-line state. */
export function lastLogLine(logs: string | undefined): string | null {
  const line = logs?.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return line ?? null;
}

export function LogDetail({
  logs,
  error,
  tail,
  paused,
  onTail,
  onPaused,
}: {
  logs: string | undefined;
  error: boolean;
  tail: number;
  paused: boolean;
  onTail: (n: number) => void;
  onPaused: (p: boolean) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="st-stack">
      <div className="st-row">
        <Select
          className="w-28 text-sm md:w-24 md:text-xs"
          value={tail}
          aria-label="Lines to show"
          onChange={(e) => onTail(Number(e.target.value))}
        >
          {TAILS.map((n) => (
            <option key={n} value={n}>
              tail {n}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="outline" aria-pressed={paused} onClick={() => onPaused(!paused)}>
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
      <div
        ref={boxRef}
        className="logbox st-log [word-break:normal]! [overflow-wrap:anywhere]! bg-bg rounded-md border border-line p-3 text-ink-dim"
      >
        {error && logs && <div className="text-bad">Couldn&apos;t refresh.</div>}
        {error && !logs ? <span className="text-bad">Couldn&apos;t read logs.</span> : logs || "no output"}
      </div>
    </div>
  );
}
