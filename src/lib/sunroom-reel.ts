/* The odometer reel's index maths, ported from SR/ds/project/components/bundle.js:7-12.
   A digit strip holds 0-9 twice. Rest positions fold into cells 5-14 so both directions always have a cell one
   step away, and a +1 or -1 change rolls exactly one cell in its own direction, across 9 to 0 and 0 to 9.
   PR 2 wires this into kiosk-digits.tsx; it lives here so node can gate it (check N9). */
export function nextReelIndex(current: number, digit: number, direction: 1 | -1 | 0): number {
  const low = digit, high = digit + 10;
  if (direction === 1) { if (low > current) return low; if (high > current) return high; }
  else if (direction === -1) { if (high < current) return high; if (low < current) return low; }
  return Math.abs(low - current) <= Math.abs(high - current) ? low : high;
}

export function foldReelIndex(index: number): number {
  return index < 5 ? index + 10 : index >= 15 ? index - 10 : index;
}
