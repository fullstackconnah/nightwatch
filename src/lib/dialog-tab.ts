/** Where Tab or Shift+Tab should jump to keep focus inside a dialog, or null to let the browser move it. `activeIdx` is -1 when focus is outside the list. */
export function trapTabTarget(activeIdx: number, count: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (activeIdx < 0) return shift ? count - 1 : 0;
  if (shift && activeIdx === 0) return count - 1;
  if (!shift && activeIdx === count - 1) return 0;
  return null;
}
