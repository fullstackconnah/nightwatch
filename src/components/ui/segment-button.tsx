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
  fill = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Unabbreviated name, for the accessible label and the hover title. Visible
   *  text is clipped to fit six tabs on a phone; the meaning must not be. */
  label?: string;
  /**
   * Stretch to share the row equally. Only the six-wide metric tab bar wants
   * this. Off by default because `flex-1 min-w-0 truncate` inside a `w-fit`
   * parent collapses the button to its padding and clips the label — that is
   * how the two-button DISK sub-view ended up rendering "STO…".
   */
  fill?: boolean;
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
        "h-11 md:h-8 px-1 sm:px-3 rounded-md text-[0.7rem] sm:text-xs font-medium transition cursor-pointer border",
        fill && "flex-1 min-w-0 truncate",
        active
          ? "bg-accent/10 text-accent border-accent/30"
          : "text-ink-dim border-transparent hover:text-ink hover:bg-panel-2",
      )}
    >
      {children}
    </button>
  );
}
