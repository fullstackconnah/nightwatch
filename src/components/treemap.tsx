"use client";

import { useEffect, useRef, useState } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { cn } from "@/lib/utils";

export interface TreemapItem {
  id: string;
  label: string;
  value: number;
}

interface PlacedRect extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

type HierarchyDatum = TreemapItem | { children: TreemapItem[] };

/**
 * Squarified treemap (Bruls/Huizing/van Wijk) via d3-hierarchy: builds a single-level
 * hierarchy from `items` and lays it out with the squarify tiling method across the
 * given pixel dimensions.
 */
function layoutTreemap(items: TreemapItem[], width: number, height: number): PlacedRect[] {
  if (!items.length || width <= 0 || height <= 0) return [];
  const total = items.reduce((a, i) => a + i.value, 0);
  if (total <= 0) return [];

  const root = hierarchy<HierarchyDatum>({ children: items })
    .sum((d) => ("value" in d ? (d.value ?? 0) : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const laidOut = treemap<HierarchyDatum>().tile(treemapSquarify).size([width, height])(root);

  return laidOut.leaves().map((leaf) => {
    const item = leaf.data as TreemapItem;
    return { ...item, x: leaf.x0, y: leaf.y0, w: leaf.x1 - leaf.x0, h: leaf.y1 - leaf.y0 };
  });
}

/** darkest -> brightest teal, quartile-ranked by magnitude (largest = darkest so light labels keep
 * contrast; area already encodes magnitude, so fill only needs to rank, not shout). */
const QUARTILE_FILLS = ["#134e4a", "#0f766e", "#0d9488", "#14b8a6"];

function quartileFill(rank: number, count: number): string {
  if (count <= 1) return QUARTILE_FILLS[QUARTILE_FILLS.length - 1];
  const q = Math.min(3, Math.floor((rank / count) * 4));
  return QUARTILE_FILLS[q];
}

/** Sentinel id for the synthetic "long tail" cell produced by `groupIntoOthers`. */
export const OTHERS_ID = "__others__";

/**
 * Folds the long tail of `items` into a single synthetic "others" item once there are more than
 * `maxCells` of them, so the treemap stays legible instead of rendering a wall of slivers. The
 * top `maxCells - 1` items by value are kept as-is; everything else is summed into one cell.
 */
export function groupIntoOthers(items: TreemapItem[], maxCells: number): TreemapItem[] {
  if (items.length <= maxCells) return items;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const kept = sorted.slice(0, maxCells - 1);
  const remainder = sorted.slice(maxCells - 1);
  const remainderSum = remainder.reduce((a, i) => a + i.value, 0);
  if (remainderSum <= 0) return kept;
  return [...kept, { id: OTHERS_ID, label: `others (${remainder.length})`, value: remainderSum }];
}

/** Tracks an element's content box in pixels via the native ResizeObserver (no new deps). */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentBoxSize?.[0];
      if (box) {
        setSize({ width: box.inlineSize, height: box.blockSize });
      } else {
        setSize({ width: el.clientWidth, height: el.clientHeight });
      }
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

export function Treemap({
  items,
  formatValue,
  onCellClick,
  className,
  heightClassName = "h-[38vh] min-h-[220px]",
  maxCells = 24,
}: {
  items: TreemapItem[];
  formatValue: (v: number) => string;
  onCellClick?: (id: string) => void;
  className?: string;
  heightClassName?: string;
  maxCells?: number;
}) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();

  const grouped = groupIntoOthers(items, maxCells);
  // The others cell is a synthetic aggregate, not a real item, so it must not shift the
  // quartile ranking of the items it was folded from.
  const realItems = grouped.filter((i) => i.id !== OTHERS_ID);
  const ranked = [...realItems].sort((a, b) => b.value - a.value);
  const rankById = new Map(ranked.map((i, idx) => [i.id, idx]));
  const rects = width > 0 && height > 0 ? layoutTreemap(grouped, width, height) : [];

  return (
    <div ref={ref} className={cn("relative w-full panel overflow-hidden", heightClassName, className)}>
      {!rects.length && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-faint text-xs">
          no data for this metric yet
        </div>
      )}
      {rects.map((r) => {
        const isOthers = r.id === OTHERS_ID;
        const rank = rankById.get(r.id) ?? 0;
        const fill = isOthers ? "var(--color-line-bright)" : quartileFill(rank, realItems.length);
        const canLabel = r.w >= 72;
        const title = `${r.label}: ${formatValue(r.value)}`;
        const cellStyle = { left: r.x, top: r.y, width: r.w, height: r.h, padding: 2 };
        const content = (
          <div className="w-full h-full rounded overflow-hidden flex flex-col justify-between p-1.5" style={{ background: fill }}>
            {canLabel && (
              <>
                <span className="truncate text-[0.7rem] text-ink font-medium">{r.label}</span>
                <span className="font-mono text-[0.625rem] text-ink truncate">{formatValue(r.value)}</span>
              </>
            )}
          </div>
        );

        // The others cell has no detail view behind it, so it renders as a plain div: not
        // focusable, not clickable, never reaches onCellClick.
        if (isOthers) {
          return (
            <div key={r.id} title={title} className="absolute text-left" style={cellStyle}>
              {content}
            </div>
          );
        }

        return (
          <button
            key={r.id}
            type="button"
            title={title}
            onClick={() => onCellClick?.(r.id)}
            className="absolute text-left cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            style={cellStyle}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
