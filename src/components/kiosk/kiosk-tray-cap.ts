import { useLayoutEffect, type RefObject } from "react";
import { snapToHalfRow } from "@/components/kiosk/tray-snap";

const GAP_TO_ANCHOR = 16; // 1rem, the cluster's own offset
const GAP_TO_SLOT = 12; // the house gap-3
const MIN_CAP = 128;

// Shared by the downloads tray and the alerts popover. Keeps the open tray 1rem above its button and one house gap below the
// forecast slot (always mounted, unlike the rail, which a glance pane swaps out), then snaps its height so the last visible row is cut
// through its middle. Re-measured on open, on slot resize, on window resize and when the row count changes while open.
// Rulings: the cut is measured at the visible bottom edge; when the cluster lifts while a tray is open (now playing starts) the cap is not
// re-run (no signal reaches the trays; the next open measures it), shortcut: upgrade if a lift mid-open shows up on the wall.
export function useTrayCap(nodeRef: RefObject<HTMLElement | null>, anchorRef: RefObject<HTMLElement | null>, open: boolean, rowCount: number) {
  useLayoutEffect(() => {
    if (!open) return;
    const node = nodeRef.current;
    if (!node) return;
    const slot = document.querySelector('[data-testid="kiosk-forecast-slot"]');
    const cap = () => {
      const vh = document.documentElement.clientHeight;
      const anchor = anchorRef.current;
      let bottom = parseFloat(getComputedStyle(node).bottom);
      if (anchor) {
        bottom = vh - anchor.getBoundingClientRect().top + GAP_TO_ANCHOR;
        node.style.bottom = `${bottom}px`;
      }
      const top = slot ? slot.getBoundingClientRect().bottom + GAP_TO_SLOT : 0;
      const room = Math.min(vh * 0.6, Math.max(MIN_CAP, vh - bottom - top));
      // Row offsets are in the padding box; maxHeight is the border box, so add the border back after snapping.
      const border = node.offsetHeight - node.clientHeight;
      const rows = Array.from(node.children, (el) => ({ top: (el as HTMLElement).offsetTop, height: (el as HTMLElement).offsetHeight }));
      const inner = room - border;
      node.style.maxHeight = `${(node.scrollHeight <= inner ? inner : snapToHalfRow(inner, rows)) + border}px`;
    };
    cap();
    const ro = slot ? new ResizeObserver(cap) : null;
    if (slot) ro?.observe(slot);
    window.addEventListener("resize", cap);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", cap);
    };
  }, [open, rowCount, anchorRef, nodeRef]);
}
