import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * Inline "are you sure" focus, the strips/write-action.tsx way: the confirm button takes
 * `autoFocus` itself; Cancel or Escape goes back to idle through `cancel`, which hands focus
 * back to the trigger. Yes does not, since the trigger is disabled while the write runs.
 */
export function useConfirmFocus(confirming: boolean, toIdle: () => void) {
  const trigger = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!confirming && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [confirming]);
  const cancel = () => {
    refocus.current = true;
    toIdle();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
  };
  return { trigger, cancel, onKeyDown };
}
