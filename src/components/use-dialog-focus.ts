import { useEffect, type KeyboardEvent, type RefObject } from "react";
import { trapTabTarget } from "@/lib/dialog-tab";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog focus: moves focus in while `active`, returns it to whatever opened the dialog afterwards,
 * and returns a keydown handler that keeps Tab inside `ref`. Escape stays with the caller.
 * The element list is read on every Tab press, since rows can be added while the dialog is open.
 */
export function useDialogFocus(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  initial?: () => HTMLElement | null | undefined,
  skipRestore?: () => boolean,
) {
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (initial?.() ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      if (!skipRestore?.()) previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (e: KeyboardEvent<HTMLElement>) => {
    const container = ref.current;
    if (e.key !== "Tab" || !container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    const target = trapTabTarget(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
    if (target !== null) {
      e.preventDefault();
      items[target].focus();
    }
  };
}
