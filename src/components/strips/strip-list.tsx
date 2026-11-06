"use client";

import { ChevronDown } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { heldRows, nextOpen, type OpenState, type OpenTarget } from "@/lib/strips";
import { cn } from "@/lib/utils";

export interface StripSpec {
  id: string;
  title: string;
  /** One fixed line; a tick changes this text and nothing else. */
  state: string;
  /** Paints the state line for a problem only. */
  tone: "warn" | "bad" | null;
  mono?: boolean;
  /** The strip's main write, always in the head. */
  slot?: ReactNode;
  body: ReactNode;
}

const HeldContext = createContext(false);
/** True while the pointer or focus is inside the strips (R5): lists inside hold their rows. */
export const useHeld = () => useContext(HeldContext);

const WIDE = "(min-width: 64rem)";
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * The strips: at 1440 the list sits beside a pane that always shows one strip's detail; at 390 the detail opens under
 * its strip, one at a time. The strip the answer names opens by itself (R4); a person's choice is kept in the URL hash
 * and never closed by the page. Disclosure is instant; only the chevron turns.
 */
export function StripList({
  strips,
  autoTarget,
  keepMounted = false,
}: {
  strips: StripSpec[];
  autoTarget: OpenTarget | "keep";
  /** Every body stays mounted and a closed one is `hidden`, so a form keeps its draft (Settings). Off for the rest. */
  keepMounted?: boolean;
}) {
  const wide = useWide();
  const [held, setHeld] = useState(false);
  const [state, setState] = useState<OpenState>({ open: null, by: null });
  const applied = useRef<string | null | undefined>(undefined);
  const committed = useRef<string[] | null>(null);

  // R5: positions hold while held; membership never changes here, so no pill.
  const live = strips.map((s) => s.id);
  const rows = heldRows(committed.current, live, held);
  committed.current = rows.rows.filter((id) => live.includes(id));
  if (committed.current.length !== live.length) committed.current = live;
  const ordered = committed.current.map((id) => strips.find((s) => s.id === id)!);

  // A person's strip from the URL hash, once.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id && live.includes(id)) setState({ open: id, by: "person" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R4: on first paint and when the answer's subject (or the width) changes; it waits while held.
  const key = `${autoTarget}|${wide}`;
  useEffect(() => {
    if (held || strips.length === 0 || applied.current === key) return;
    applied.current = key;
    setState((s) => nextOpen(s, autoTarget, wide));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, held, strips.length]);

  function toggle(id: string) {
    const closing = state.open === id && !wide;
    setState(closing ? { open: null, by: null } : { open: id, by: "person" });
    window.history.replaceState(null, "", closing ? window.location.pathname + window.location.search : `#${id}`);
  }

  // An open id that names no strip here (nextOpen's wide fallback is Minecraft's "server") shows the first strip.
  const open = wide ? (ordered.some((x) => x.id === state.open) ? state.open : (ordered[0]?.id ?? null)) : state.open;
  const sel = ordered.find((s) => s.id === open);
  return (
    <HeldContext.Provider value={held}>
      <div
        className={cn("st-grid", wide && "st-wide")}
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
        }}
      >
        <div className="panel st-list" data-feature="strips">
          {ordered.map((s) => {
            const on = s.id === open;
            return (
              <div key={s.id} className="st-strip" data-row-id={s.id} data-on={on ? "" : undefined}>
                <div className="st-sh">
                  <button
                    type="button"
                    className="st-open"
                    aria-expanded={on}
                    aria-controls={wide ? "st-pane" : `st-body-${s.id}`}
                    data-k={`open-${s.id}`}
                    onClick={() => toggle(s.id)}
                  >
                    <ChevronDown className="st-chev" size={14} aria-hidden />
                    <span className="st-name">{s.title}</span>
                    <span className="st-state" data-tone={s.tone ?? undefined} data-mono={s.mono ? "" : undefined}>
                      {s.state}
                    </span>
                  </button>
                  {s.slot && <div className="st-slot">{s.slot}</div>}
                </div>
                {(on || keepMounted) && !wide && (
                  <div className="st-body" id={`st-body-${s.id}`} hidden={!on}>
                    {s.body}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {wide && (
          <section className="panel st-pane" id="st-pane" aria-label={sel?.title ?? "Detail"}>
            {sel && (
              <>
                <header className="st-panehead">
                  <h2>{sel.title}</h2>
                </header>
                {keepMounted
                  ? ordered.map((s) => (
                      <div key={s.id} hidden={s.id !== sel.id}>
                        {s.body}
                      </div>
                    ))
                  : sel.body}
              </>
            )}
          </section>
        )}
      </div>
    </HeldContext.Provider>
  );
}

/** A list inside a strip that holds its rows while the strips are held (R5): new rows wait behind "N new · show". */
export function useHeldList(live: readonly string[]) {
  const held = useHeld();
  const committed = useRef<string[] | null>(null);
  const [, bump] = useState(0);
  const h = heldRows(committed.current, live, held);
  committed.current = h.rows;
  return {
    ...h,
    show: () => {
      committed.current = live.slice();
      bump((n) => n + 1);
    },
  };
}
