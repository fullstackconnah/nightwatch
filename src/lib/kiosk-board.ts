/* Standard view board (direction B): the pure layout choices, kept out of the components so they are unit-tested.
 * The 12-column board puts Today beside Climate (row 1) and Lights and switches beside Scenes (row 2). */
import { shortenSharedPrefix } from "./kiosk-chip-names.ts";

/** Row 1 spans at `lg` by the number of climate zones; `tileColumns` is the Climate tile grid at `lg`. 0 zones: no Climate cell. */
export function rowOneSpans(zones: number): { today: number; climate: number; tileColumns: number } {
  if (zones <= 0) return { today: 12, climate: 0, tileColumns: 0 };
  if (zones === 1) return { today: 7, climate: 5, tileColumns: 1 };
  if (zones === 2) return { today: 5, climate: 7, tileColumns: 2 };
  return { today: 4, climate: 8, tileColumns: 3 }; // 4+ zones wrap and the page scrolls
}

/** Row 2 spans at `lg`: chips are Lights and switches together, `side` is the Scenes (and Sensors) panel. */
export function rowTwoLayout(hasChips: boolean, hasSide: boolean): { chips: number; side: number; chipColumns: number; sceneColumns: number } {
  if (hasChips && hasSide) return { chips: 8, side: 4, chipColumns: 3, sceneColumns: 2 };
  if (hasChips) return { chips: 12, side: 0, chipColumns: 4, sceneColumns: 0 };
  if (hasSide) return { chips: 0, side: 12, chipColumns: 0, sceneColumns: 4 };
  return { chips: 0, side: 0, chipColumns: 0, sceneColumns: 0 };
}

// Whole class strings, because Tailwind only emits classes it can read in the source.
export const LG_COL_SPAN: Record<number, string> = {
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  12: "lg:col-span-12",
};

interface Toggle {
  entityId: string;
  name: string;
  on: boolean;
}

/** Lights then switches in one list, Home Assistant order inside each group. The shared prefix is stripped once over the merged names. */
export function mergeToggles<L extends Toggle, S extends Toggle>(lights: L[], switches: S[]) {
  const all = [
    ...lights.map((item) => ({ kind: "light" as const, item })),
    ...switches.map((item) => ({ kind: "switch" as const, item })),
  ];
  const { labels, qualifier } = shortenSharedPrefix(all.map((e) => e.item.name));
  const on = all.filter((e) => e.item.on).length;
  return {
    entries: all.map((e, i) => ({ ...e, label: labels[i] })),
    qualifier,
    note: `${on} of ${all.length} on`,
  };
}
