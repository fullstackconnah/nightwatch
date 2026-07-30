"use client";

import { cn } from "@/lib/utils";

/**
 * The one segmented-control button used across /resources: the metric tabs, the
 * DISK storage/IO sub-view, and the ALL tab's processes/containers toggle. Shared
 * rather than re-declared per surface so all three stay the same shape — a
 * toggle that looks subtly different in two places means one of them is wrong.
 */
export function SegmentButton({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Unabbreviated name, for the accessible label and the hover title. Visible
   *  text is clipped to fit six tabs on a phone; the meaning must not be. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        // px-1 on the narrowest phones, px-3 from sm up: six tabs at px-3 overflow a
        // 360px viewport, and a horizontal scroll strip would hide tabs behind a
        // gesture nobody discovers.
        "flex-1 min-w-0 h-11 md:h-8 px-1 sm:px-3 rounded-md text-[0.7rem] sm:text-xs font-medium transition cursor-pointer border truncate",
        active
          ? "bg-accent/10 text-accent border-accent/30"
          : "text-ink-dim border-transparent hover:text-ink hover:bg-panel-2",
      )}
    >
      {children}
    </button>
  );
}
