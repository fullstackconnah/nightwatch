"use client";

import { useEffect, useRef, useState } from "react";
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

/** Aspect-ratio "badness" of a row of areas laid along a fixed side length. Lower is squarer. */
function worstRatio(areas: number[], side: number): number {
  let max = -Infinity;
  let min = Infinity;
  let sum = 0;
  for (const a of areas) {
    if (a > max) max = a;
    if (a < min) min = a;
    sum += a;
  }
  const sideSq = side * side;
  const sumSq = sum * sum;
  return Math.max((sideSq * max) / sumSq, sumSq / (sideSq * min));
}

/**
 * Squarified treemap (Bruls/Huizing/van Wijk). Lays items into rows along
 * whichever side of the remaining rect is currently shortest, growing each row
 * while doing so keeps cell aspect ratios closer to square, then slices off
 * that row and recurses on what's left.
 */
export function squarify(items: TreemapItem[], x: number, y: number, w: number, h: number): PlacedRect[] {
  if (!items.length || w <= 0 || h <= 0) return [];
  const total = items.reduce((a, i) => a + i.value, 0);
  if (total <= 0) return [];

  const scale = (w * h) / total;
  const areas = items.map((i) => i.value * scale);

  const rects: PlacedRect[] = [];
  let idx = 0;
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;

  while (idx < items.length) {
    const side = Math.min(cw, ch);
    let rowAreas = [areas[idx]];
    let rowEnd = idx + 1;
    while (rowEnd < items.length) {
      const testAreas = [...rowAreas, areas[rowEnd]];
      if (worstRatio(testAreas, side) <= worstRatio(rowAreas, side)) {
        rowAreas = testAreas;
        rowEnd++;
      } else {
        break;
      }
    }

    const rowSum = rowAreas.reduce((a, b) => a + b, 0);
    const placeAsColumn = cw >= ch; // remaining rect is wide -> row becomes a column along the short (height) side

    if (placeAsColumn) {
      const colWidth = rowSum / ch;
      let oy = cy;
      for (let k = idx; k < rowEnd; k++) {
        const itemH = areas[k] / colWidth;
        rects.push({ ...items[k], x: cx, y: oy, w: colWidth, h: itemH });
        oy += itemH;
      }
      cx += colWidth;
      cw -= colWidth;
    } else {
      const rowHeight = rowSum / cw;
      let ox = cx;
      for (let k = idx; k < rowEnd; k++) {
        const itemW = areas[k] / rowHeight;
        rects.push({ ...items[k], x: ox, y: cy, w: itemW, h: rowHeight });
        ox += itemW;
      }
      cy += rowHeight;
      ch -= rowHeight;
    }

    idx = rowEnd;
  }

  return rects;
}

/** darkest -> brightest teal, quartile-ranked by magnitude (largest = brightest = most legible). */
const QUARTILE_FILLS = ["#134e4a", "#0f766e", "#14b8a6", "#2dd4bf"];

function quartileFill(rank: number, count: number): string {
  if (count <= 1) return QUARTILE_FILLS[QUARTILE_FILLS.length - 1];
  const q = Math.min(3, Math.floor((rank / count) * 4));
  return QUARTILE_FILLS[q];
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
}: {
  items: TreemapItem[];
  formatValue: (v: number) => string;
  onCellClick?: (id: string) => void;
  className?: string;
  heightClassName?: string;
}) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();

  const ranked = [...items].sort((a, b) => b.value - a.value);
  const rankById = new Map(ranked.map((i, idx) => [i.id, idx]));
  const rects = width > 0 && height > 0 ? squarify(items, 0, 0, width, height) : [];

  return (
    <div ref={ref} className={cn("relative w-full panel overflow-hidden", heightClassName, className)}>
      {!rects.length && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-faint text-xs">
          no data for this metric yet
        </div>
      )}
      {rects.map((r) => {
        const rank = rankById.get(r.id) ?? 0;
        const fill = quartileFill(rank, items.length);
        const canLabel = r.w >= 72;
        return (
          <button
            key={r.id}
            type="button"
            title={`${r.label}: ${formatValue(r.value)}`}
            onClick={() => onCellClick?.(r.id)}
            className="absolute text-left cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              padding: 2,
            }}
          >
            <div className="w-full h-full rounded overflow-hidden flex flex-col justify-between p-1.5" style={{ background: fill }}>
              {canLabel && (
                <>
                  <span className="truncate text-[0.7rem] text-ink font-medium">{r.label}</span>
                  <span className="font-mono text-[0.625rem] text-ink truncate">{formatValue(r.value)}</span>
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
