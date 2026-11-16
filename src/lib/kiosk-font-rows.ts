/* The Typeface tab's chip rows, kept pure (and free of kiosk-theme's next/font
   imports) so a node test can pin the order. Text: a sans row, then a serif
   row; Numerals: one mono row. In each row the theme's default leads, the rest
   run A to Z. A theme default of another kind (five themes put a serif face in
   Numerals) joins the Numerals row, so it stays visible and resettable. */
type Kind = "sans" | "serif" | "mono";
interface Face {
  id: string;
  label: string;
  kind: Kind;
}

export interface FontRow<T extends Face> {
  kind: Kind;
  options: T[];
}

export function fontRows<T extends Face>(fonts: readonly T[], slot: "sans" | "mono", defaultId: string): FontRow<T>[] {
  const kinds: readonly Kind[] = slot === "sans" ? ["sans", "serif"] : ["mono"];
  const pool = fonts.filter((f) => kinds.includes(f.kind) || f.id === defaultId);
  const lead = (a: T, b: T) =>
    Number(b.id === defaultId) - Number(a.id === defaultId) || a.label.localeCompare(b.label);
  // Numerals is one row whatever the kinds (the off-kind default is unioned in); Text is one row per kind.
  const rows: FontRow<T>[] = kinds.map((kind) => ({
    kind,
    options: pool.filter((f) => slot === "mono" || f.kind === kind).sort(lead),
  }));
  return rows.filter((r) => r.options.length);
}
