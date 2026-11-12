"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { LIFECYCLE_META } from "@/components/resources/container-controls";
import { fetcher, postJson } from "@/lib/client";
import { LOGS_COPY, actionErrorText, doneText, logsErrorText, tailLines, type Fix, type FixAction } from "@/lib/fix-sheet";
import { cn } from "@/lib/utils";

export interface FixDone {
  at: number;
  /** HH:MM of a later check that still lists the hit; the button is re-armed. */
  still?: string;
}

const PENDING: Record<FixAction, string> = { start: "Starting…", restart: "Restarting…" };
const online = () => typeof navigator === "undefined" || navigator.onLine;

/** The open block of a "Needs you" row: cause, the last 20 log lines as text, and at most one action. Mounted only while open, so logs load only then. */
export function FixSheet({
  id,
  fix,
  resolved,
  done,
  onDone,
}: {
  id: string;
  fix: Fix;
  resolved: boolean;
  done: FixDone | null;
  onDone: (at: number) => void;
}) {
  const { data, error, mutate } = useSWR<{ logs: string }>(fix.logsUrl, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
  const lines = useMemo(() => (data ? tailLines(data.logs) : []), [data]);
  const logsErr = error ? logsErrorText(error, online()) : null;
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<{ text: string; rearm: boolean } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const finished = done !== null && done.still === undefined;
  // A later report still lists the hit: drop the sent-no-answer error, or it would outrank the status and hide the button for good.
  const stillAt = done?.still;
  useEffect(() => {
    if (stillAt !== undefined) setErr(null);
  }, [stillAt]);
  useEffect(() => {
    if (finished) statusRef.current?.focus();
  }, [finished]);

  async function run(action: FixAction) {
    if (!online()) return setErr(actionErrorText(new TypeError("offline"), action, false));
    setPending(true);
    setErr(null);
    try {
      await postJson(fix.actionUrl, { action });
      onDone(Date.now());
      timer.current = setTimeout(() => void mutate(), 2000); // the box shows the new start
    } catch (e) {
      setErr(actionErrorText(e, action, online()));
      if (e instanceof TypeError && online()) onDone(Date.now()); // sent, no answer: same memory as a success, so a later report still listing it re-arms
    } finally {
      setPending(false);
    }
  }

  const action = fix.action;
  const gone = logsErr?.kind === "gone" || (err !== null && !err.rearm);
  const canAct = action !== null && !resolved && !finished && !gone;
  const status = resolved
    ? "Cleared at the last check."
    : err
      ? err.text
      : finished
        ? doneText(action ?? "restart", done.at)
        : done?.still
          ? `Still failing at the ${done.still} check. Read the lines above, then try again.`
          : "";
  const Icon = action ? LIFECYCLE_META[action].Icon : null;

  return (
    <div id={`hm-fix-${id}`} className="hm-fix" role="region" aria-label={`Fix ${fix.name}`}>
      <p className="hm-fix-cause">{fix.cause}</p>
      <div className="hm-fix-head">
        <span className="microlabel">Last 20 lines</span>
        <Link href={`/logs?c=${encodeURIComponent(fix.name)}`} className="text-[0.7rem] text-ink-faint hover:text-accent transition-colors whitespace-nowrap">
          All logs
        </Link>
      </div>
      <div className="logbox bg-bg rounded-md border border-line p-3">
        {logsErr ? (
          <span>
            {logsErr.text}
            {logsErr.kind === "failed" && (
              <>
                {" "}
                <Button variant="ghost" size="sm" onClick={() => void mutate()}>
                  Try again
                </Button>
              </>
            )}
          </span>
        ) : !data ? (
          <span className="text-ink-dim">{LOGS_COPY.loading}</span>
        ) : lines.length === 0 ? (
          <span className="text-ink-dim">{LOGS_COPY.empty}</span>
        ) : (
          lines.map((l, i) => <div key={i}>{l}</div>)
        )}
      </div>
      {(canAct || status) && (
        <div className="hm-fix-act">
          {canAct && Icon && action && (
            <Button variant="outline" size="sm" disabled={pending} aria-busy={pending || undefined} onClick={() => void run(action)}>
              <Icon size={14} aria-hidden className={cn(pending && "animate-spin motion-reduce:animate-none")} />
              {pending ? PENDING[action] : `${LIFECYCLE_META[action].label} ${fix.name}`}
            </Button>
          )}
          {status && !pending && (
            <p ref={statusRef} role="status" tabIndex={-1} className="m-0 text-xs text-ink-dim outline-none">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
