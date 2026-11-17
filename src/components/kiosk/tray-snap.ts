export interface TrayRow {
  top: number;
  height: number;
}

// Pure so node:test can load it. Rows are offsets inside the scroll box, cap is the visible height, both in px.
// Returns the visible height that cuts the first row crossing the cap through its middle, so the cut reads as "more below".
// When that middle lies past the cap (the cut would grow the tray), the row before is cut instead; a first row that crosses keeps the cap.
export function snapToHalfRow(cap: number, rows: readonly TrayRow[]): number {
  const i = rows.findIndex((r) => r.top + r.height > cap);
  if (i < 0) return cap;
  const mid = (r: TrayRow) => r.top + r.height / 2;
  if (mid(rows[i]) <= cap) return mid(rows[i]);
  return i > 0 ? mid(rows[i - 1]) : cap;
}
