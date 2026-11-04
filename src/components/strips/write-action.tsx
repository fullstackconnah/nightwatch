"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "asking" | "flight" | "failed";

/**
 * The strips pattern's one write idiom: an outlined trigger, an inline frame that asks once ("Yes, {verb}", Cancel),
 * the flight line, then done (the trigger returns) or failed (the reason, Try again, Dismiss). Danger tints only the
 * Yes. Escape cancels; Yes takes focus when the frame opens. `confirm={false}` skips the question (Start, Back up).
 */
export function WriteAction({
  label,
  ariaLabel,
  icon,
  primary,
  confirm = true,
  say,
  yes,
  danger,
  flight,
  failure,
  disabled,
  describedBy,
  run,
  onPending,
  onActive,
  autoCancelMs,
  renderAsk,
}: {
  label: string;
  ariaLabel?: string;
  icon?: ReactNode;
  /** The house default (accent) trigger, for the affirmative verbs (Start); everything else is outlined. */
  primary?: boolean;
  confirm?: boolean;
  say?: string;
  yes?: string;
  danger?: boolean;
  flight: string;
  /** "Couldn’t stop the server": the reason is appended. */
  failure: string;
  disabled?: boolean;
  describedBy?: string;
  /** Throws on failure; the message becomes the reason. */
  run: () => Promise<void>;
  /** Lets a list hold its other writes while one is in flight. */
  onPending?: (pending: boolean) => void;
  /** True from the question until the write is done or dismissed; lets a pair of writes show one frame at a time. */
  onActive?: (active: boolean) => void;
  /** The question cancels itself after this long (a lock is a door: Smart home's 4 s). */
  autoCancelMs?: number;
  /** Replaces the default question (the shared ConfirmStop). */
  renderAsk?: (p: { onYes: () => void; onCancel: () => void }) => ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (phase === "idle" && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [phase]);

  // An open question or failure must not outlive the write being turned off (the state changed under it).
  useEffect(() => {
    if (disabled) setPhase((p) => (p === "asking" || p === "failed" ? "idle" : p));
  }, [disabled]);

  async function go() {
    setPhase("flight");
    onPending?.(true);
    try {
      await run();
      setPhase("idle");
    } catch (e) {
      setReason(e instanceof Error && e.message ? e.message.replace(/\.$/, "") : "no reason given");
      setPhase("failed");
    } finally {
      onPending?.(false);
    }
  }
  const cancel = () => {
    refocus.current = true;
    setPhase("idle");
  };

  useEffect(() => {
    if (phase !== "asking" || !autoCancelMs) return;
    const t = setTimeout(cancel, autoCancelMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, autoCancelMs]);
  useEffect(() => {
    onActive?.(phase !== "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "idle") {
    return (
      <Button
        ref={trigger}
        size="sm"
        variant={primary ? "default" : "outline"}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={disabled ? describedBy : undefined}
        onClick={() => (confirm ? setPhase("asking") : void go())}
      >
        {icon}
        {label}
      </Button>
    );
  }
  if (phase === "asking") {
    return (
      <div
        key="confirm"
        // ConfirmStop (renderAsk) already grows in; both would compound the .97 scale.
        className={renderAsk ? "st-frame" : "st-frame nw-confirm"}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
        }}
      >
        {renderAsk ? (
          renderAsk({ onYes: () => void go(), onCancel: cancel })
        ) : (
          <>
            <p className="st-say">{say}</p>
            <div className="st-acts">
              <Button size="sm" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button autoFocus size="sm" variant={danger ? "danger" : "default"} onClick={() => void go()}>
                {yes}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }
  if (phase === "flight") {
    return (
      <div className="st-frame" aria-busy="true">
        <p className="st-say" role="status">
          {flight}
        </p>
      </div>
    );
  }
  return (
    <div key="error" data-kind="error" className="st-frame nw-confirm">
      <p className="st-say" role="alert">
        {failure}: {reason}.
      </p>
      <div className="st-acts">
        <Button size="sm" variant="outline" onClick={() => void go()}>
          Try again
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPhase("idle")}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
