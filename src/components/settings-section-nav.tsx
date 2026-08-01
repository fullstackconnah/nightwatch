"use client";

/* THESIS: Settings grew five ranked sections (Access, Integrations, Hermes,
   Dashboard, Reference) once the reorg landed — enough that "scroll and
   hope" stops working, especially on the tall Dashboard/Tiles section. This
   is a quick-jump strip, not a second sidebar: it borrows the log console's
   rail idiom (a horizontally-scrolling snap row on touch, precedent per
   DESIGN.md's Layout section) and the exact nav-item-active recipe
   side-nav.tsx already uses (bg-accent/10 text-accent border-accent/20),
   rather than inventing a new "active" treatment. Sticky from md up only —
   mobile already carries a sticky top bar and a fixed bottom tab bar, and a
   third sticky layer on a 390px-tall viewport would eat too much of it. */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SettingsSection {
  id: string;
  label: string;
}

// How far below the viewport top the "current section" line sits — clears
// the sticky rail itself (h-7/h-11 plus padding) with room to spare.
const THRESHOLD_PX = 120;

export function SettingsSectionNav({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const elements = sections
      .map((s) => ({ id: s.id, el: document.getElementById(s.id) }))
      .filter((s): s is { id: string; el: HTMLElement } => s.el !== null);
    if (elements.length === 0) return;

    // Plain "last section whose top has scrolled above the threshold line"
    // scrollspy rather than IntersectionObserver's narrow-band trick — a
    // section tall enough to span the whole viewport (Dashboard, with its
    // filterable tiles table) can end up with no entry actually inside a
    // percentage-based band after a layout reflow (e.g. the tiles filter
    // shrinking the table), leaving the highlight stuck on the previous
    // section. Reading getBoundingClientRect directly on every scroll tick
    // has no such dead zone: some section is always "last past the line".
    let ticking = false;
    function update() {
      ticking = false;
      let current = elements[0].id;
      for (const { id, el } of elements) {
        if (el.getBoundingClientRect().top <= THRESHOLD_PX) current = id;
      }
      setActive(current);
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Content below the fold can change height without any scroll event at
    // all — the tiles filter narrowing 32 rows to 3 is exactly that case.
    // Re-run the same threshold check whenever the page's own layout moves.
    const resizeObserver = new ResizeObserver(onScroll);
    resizeObserver.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      resizeObserver.disconnect();
    };
  }, [sections]);

  function jump(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  return (
    <nav aria-label="Settings sections" className="md:sticky md:top-4 z-10">
      <div
        ref={navRef}
        className="panel bg-panel/85 backdrop-blur flex gap-1 overflow-x-auto snap-x p-1"
        style={{ scrollbarWidth: "none" }}
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            aria-current={active === s.id ? "true" : undefined}
            className={cn(
              "shrink-0 snap-start whitespace-nowrap rounded-md px-3 h-11 md:h-7 inline-flex items-center text-xs font-medium transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent border",
              active === s.id
                ? "bg-accent/10 text-accent border-accent/20"
                : "text-ink-dim hover:text-ink hover:bg-panel-2 border-transparent",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
