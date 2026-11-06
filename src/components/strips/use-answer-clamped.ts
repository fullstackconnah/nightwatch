"use client";

import { useEffect, useState } from "react";

/** The head answer is cut off by its two-line slot (R3) when its content is taller than its box. */
export const isClamped = (scrollHeight: number, clientHeight: number) => scrollHeight > clientHeight + 1;

/**
 * The strips pattern's detail lead repeats the head answer at the top of the auto-opened strip, but only while the
 * head clamps it (R3). Returns `lead` while the answer is clamped, else null; null before the first measure, so a
 * short answer never flashes the lead in and out.
 */
export function useClampedLead(lead: string | null): string | null {
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-feature="answer"]');
    if (!lead || !el) {
      setClamped(false);
      return;
    }
    const measure = () => setClamped(isClamped(el.scrollHeight, el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lead]);
  return clamped ? lead : null;
}
