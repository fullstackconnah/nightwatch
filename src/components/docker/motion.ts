/* The two motions /docker owns: a 600 ms count-down for sizes, and FLIP for reorders and removals
   (transform only, 420 ms on --ease-calm). Reduced motion: the number jumps; new rows fade, nothing translates. */
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Eases toward `target` over 600 ms from wherever it is now. */
export function useCountTo(target: number): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduced() || cur.current === target) {
      cur.current = target;
      setV(target);
      return;
    }
    const from = cur.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 600);
      cur.current = from + (target - from) * (1 - (1 - k) ** 3);
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

/**
 * FLIP for `[data-row-id]` children. Runs only when `key` changed since the last render, and not for the render
 * after `skip()` (disclosure, segment and search changes are instant).
 */
export function useFlip(ref: RefObject<HTMLElement | null>, key: string) {
  const tops = useRef<Map<string, number>>(new Map());
  const lastKey = useRef<string | null>(null);
  const skipNext = useRef(false);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const now = new Map<string, number>();
    const rm = reduced();
    const animate = tops.current.size > 0 && lastKey.current !== key && !skipNext.current;
    root.querySelectorAll<HTMLElement>("[data-row-id]").forEach((el) => {
      const top = el.getBoundingClientRect().top;
      now.set(el.dataset.rowId as string, top);
      if (!animate || !el.animate) return;
      const was = tops.current.get(el.dataset.rowId as string);
      if (was == null) el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
      else if (!rm && Math.abs(was - top) >= 1) {
        el.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], {
          duration: 420,
          easing: "cubic-bezier(.2, .8, .2, 1)",
        });
      } else if (rm && Math.abs(was - top) >= 1) el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    });
    tops.current = now;
    lastKey.current = key;
    skipNext.current = false;
  });
  return { skip: () => (skipNext.current = true) };
}
