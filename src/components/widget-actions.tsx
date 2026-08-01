/* THESIS: three homelab apps get remote-control buttons — Pi-hole, the *arr pair,
   qBittorrent — and every one of them mutates something on a real box. No affordance
   here may fire on a single tap; the inline two-step confirm (this app's one "are you
   sure" idiom, from reclaim-shared.tsx) is non-negotiable.
   OWN-WORLD: nightwatch console — ghost buttons, panel-hover popover, mono result
   copy, real API failure text over a generic "action failed". */
"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/client";
import { actionsForWidgetType, type WidgetActionDef } from "@/lib/widgets/actions";
import { cn } from "@/lib/utils";

interface ActionResult {
  id: string;
  ok: boolean;
  message: string;
}

/**
 * One call in flight at a time, mirroring useLifecycle's own rule for the same
 * reason: a second click while the app's own API is mid-request isn't a
 * request worth sending. Shared by both the detail-page row and the overview
 * popover so the confirm/busy/result machine is defined exactly once.
 */
function useWidgetActionRunner(container: string) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function run(action: WidgetActionDef) {
    setPendingId(action.id);
    setConfirmId(null);
    setResult(null);
    try {
      const res = (await postJson("/api/widgets/action", {
        container,
        action: action.id,
      })) as { ok: boolean; message: string };
      setResult({ id: action.id, ok: res.ok, message: res.message });
    } catch (e) {
      setResult({ id: action.id, ok: false, message: e instanceof Error ? e.message : "action failed" });
    } finally {
      setPendingId(null);
    }
  }

  return { confirmId, setConfirmId, pendingId, result, run };
}

function ResultLine({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p className={cn("text-[0.7rem] leading-snug", result.ok ? "text-ok" : "text-bad")} role="status">
      {result.message}
    </p>
  );
}

/**
 * The detail page's own action row, inside the Service widget card: ghost
 * buttons at rest, an inline confirm/cancel pair replacing the one being
 * confirmed, a spinner while in flight, the app's own response as real copy
 * underneath. Renders nothing when the widget type carries no curated
 * actions — most widget types never show this row.
 */
export function WidgetActionRow({
  container,
  widgetType,
  className,
}: {
  container: string;
  widgetType: string;
  className?: string;
}) {
  const actions = actionsForWidgetType(widgetType);
  const { confirmId, setConfirmId, pendingId, result, run } = useWidgetActionRunner(container);
  if (!actions.length) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => {
          const confirming = confirmId === action.id;
          const busy = pendingId === action.id;
          if (confirming) {
            return (
              <span key={action.id} className="inline-flex items-center gap-1.5 flex-wrap">
                <span className="text-[0.7rem] text-ink-dim">{action.confirm}</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="outline" onClick={() => void run(action)}>
                  Confirm
                </Button>
              </span>
            );
          }
          return (
            <Button
              key={action.id}
              size="sm"
              variant="ghost"
              disabled={pendingId !== null}
              aria-busy={busy}
              onClick={() => setConfirmId(action.id)}
            >
              {busy && <RotateCw size={12} className="animate-spin motion-reduce:animate-none" />}
              {action.label}
            </Button>
          );
        })}
      </div>
      <ResultLine result={result} />
    </div>
  );
}

/**
 * The overview tile's compact affordance: a single 44px ellipsis button that
 * opens a small panel-styled menu, so the action list costs nothing at rest
 * and doesn't compete with the glance-density the tile grid is built for.
 * Same confirm/busy/result machine as the row above, condensed.
 */
export function WidgetActionsMenu({ container, widgetType }: { container: string; widgetType: string }) {
  const actions = actionsForWidgetType(widgetType);
  const { confirmId, setConfirmId, pendingId, result, run } = useWidgetActionRunner(container);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Closing the menu leaves a stale confirm/result behind for next open — clear it.
  useEffect(() => {
    if (!open) setConfirmId(null);
  }, [open, setConfirmId]);

  if (!actions.length) return null;

  return (
    <div ref={rootRef} className="relative">
      <Button
        size="icon"
        variant="ghost"
        className="h-10 w-10 md:h-7 md:w-7"
        aria-label={`${container} app actions`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal size={13} />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={`${container} app actions`}
          className="panel absolute right-0 top-full mt-1 w-60 !p-1.5 z-20 space-y-0.5"
        >
          {actions.map((action) => {
            const confirming = confirmId === action.id;
            const busy = pendingId === action.id;
            if (confirming) {
              return (
                <div key={action.id} className="space-y-1 px-1.5 py-1">
                  <p className="text-[0.7rem] text-ink-dim">{action.confirm}</p>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void run(action)}>
                      Confirm
                    </Button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={pendingId !== null}
                className="w-full text-left h-10 md:h-7 px-2 rounded-md text-xs text-ink-dim hover:text-ink hover:bg-panel-2 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
                onClick={() => setConfirmId(action.id)}
              >
                {busy && <RotateCw size={11} className="animate-spin motion-reduce:animate-none" />}
                {action.label}
              </button>
            );
          })}
          {result && (
            <div className="px-1.5 pt-1 border-t border-line/60">
              <ResultLine result={result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** True when a container's widget both is config.json-sourced and has curated
 *  actions — the one check both surfaces need before rendering anything. */
export function hasWidgetActions(widget: { type: string; configured?: boolean } | undefined): boolean {
  return !!widget?.configured && actionsForWidgetType(widget.type).length > 0;
}
