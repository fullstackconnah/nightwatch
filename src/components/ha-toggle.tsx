"use client";

import { cn } from "@/lib/utils";

/**
 * Shared on/off control for the Lights and Switches domains — declared once so
 * a toggle never looks subtly different between the two panels (DESIGN.md's
 * "don't re-declare a local variant of a shared control"). The button itself
 * is the 44px touch target (`h-11 w-14` on mobile, dropping to the pointer
 * height/width pair on `md`); the pill track inside it is purely visual and
 * carries `aria-hidden` so the button's own `role="switch"` is the one thing
 * assistive tech sees.
 */
export function HaSwitchControl({
  on,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className="flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40 md:h-7 md:w-12"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-6 w-11 items-center rounded-full border px-0.5 transition-colors md:h-5 md:w-9",
          on ? "justify-end border-accent/40 bg-accent/20" : "justify-start border-line bg-panel-2",
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full transition-transform duration-150 ease-out motion-reduce:transition-none md:h-4 md:w-4",
            on ? "bg-accent" : "bg-ink-faint",
          )}
        />
      </span>
    </button>
  );
}
