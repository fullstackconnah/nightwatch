"use client";

/* Per-theme font overrides for /kiosk. Each theme already ships its own
   typeface pairing (kiosk-theme.tsx's 23 next/font families, mapped onto
   --font-sans/--font-mono by the [data-kiosk-theme] blocks in globals.css) —
   this module lets a device swap either slot for a DIFFERENT already-loaded
   family without touching CSS or downloading anything new. No font is ever
   added here: KIOSK_FONTS is a relabeling of families kiosk-theme.tsx already
   pays to load, so picking any entry costs nothing extra.

   State pattern mirrors kiosk-theme.tsx's setKioskTheme/useKioskTheme exactly
   (STORAGE_KEY + CHANGE_EVENT + a setter that persists-then-broadcasts + a
   hook that seeds from storage and live-updates from the broadcast) for the
   same reason that file does it: the switcher and the scope div that applies
   the result have no shared ancestor worth hanging a context provider on. */

import { useEffect, useState } from "react";
import { KIOSK_THEMES, type KioskTheme } from "@/components/kiosk-theme";

export type KioskFontId =
  | "terminal"
  | "journal"
  | "lounge"
  | "folio-sans"
  | "folio-mono"
  | "slate-serif"
  | "slate-mono"
  | "sunroom-sans"
  | "sunroom-mono"
  | "aerogel-sans"
  | "aerogel-mono"
  | "bulletin-serif"
  | "bulletin-sans"
  | "understory-serif"
  | "understory-sans"
  | "duotone-serif"
  | "cinder-sans"
  | "cinder-mono"
  | "aurora-sans"
  | "aurora-mono"
  | "chrome-sans"
  | "neon-mono"
  | "pixel-mono"
  | "lexend"
  | "figtree"
  | "manrope"
  | "chivo-mono"
  | "system-sans"
  | "system-mono";

export interface KioskFontOption {
  id: KioskFontId;
  /** Human label for the picker — the family's real name, not the theme it
   *  was introduced with (a face picked for another theme should read as
   *  itself, not as "Bulletin's font"). */
  label: string;
  kind: "sans" | "serif" | "mono";
  /** The complete CSS font-family value to assign to --font-sans/--font-mono:
   *  `var(--font-t-*), <fallback>` for a theme-linked face — the exact same
   *  fallback chain that face's own home theme already uses in globals.css,
   *  so applying it to a DIFFERENT theme behaves identically to how it's
   *  already proven to render — or, for the two system options, the literal
   *  base stack itself (globals.css:44-45) with no `--font-t-*` var at all. */
  cssVar: string;
}

/** 23 theme-linked families (one entry per --font-t-* variable in
 *  kiosk-theme.tsx:55-80) plus the 2 base stacks (globals.css:44-45), so a
 *  user can always dial a theme back to the neutral face, plus 4 picker-only
 *  families (lexend, figtree, manrope, chivo-mono) that aren't any theme's
 *  default — curated purely for distance-legible text and display numerals.
 *  `kind` is the family's own typographic design (a serif face is "serif" even on the
 *  five themes — journal, lounge, bulletin, understory, duotone — that
 *  deliberately plug a serif face into the --font-mono slot for an
 *  editorial numeral look rather than an actual monospace face; see each
 *  theme's own comment in globals.css). The Typeface picker's "Numerals" tab
 *  filters by kind === "mono" and separately unions in the active theme's
 *  actual mono default even when it's off-kind, so that quirk stays visible
 *  and resettable instead of silently vanishing from the list. */
export const KIOSK_FONTS: readonly KioskFontOption[] = [
  { id: "terminal", label: "IBM Plex Mono", kind: "mono", cssVar: 'var(--font-t-terminal), ui-monospace, "Cascadia Code", Menlo, monospace' },
  { id: "journal", label: "Newsreader", kind: "serif", cssVar: 'var(--font-t-journal), Georgia, "Times New Roman", serif' },
  { id: "lounge", label: "Fraunces", kind: "serif", cssVar: "var(--font-t-lounge), Georgia, serif" },
  { id: "folio-sans", label: "Work Sans", kind: "sans", cssVar: 'var(--font-t-folio-sans), "Helvetica Neue", Arial, sans-serif' },
  { id: "folio-mono", label: "Spline Sans Mono", kind: "mono", cssVar: "var(--font-t-folio-mono), ui-monospace, monospace" },
  { id: "slate-serif", label: "Source Serif 4", kind: "serif", cssVar: "var(--font-t-slate-serif), Georgia, serif" },
  { id: "slate-mono", label: "Courier Prime", kind: "mono", cssVar: 'var(--font-t-slate-mono), "Courier New", monospace' },
  { id: "sunroom-sans", label: "Quicksand", kind: "sans", cssVar: 'var(--font-t-sunroom-sans), "Segoe UI", sans-serif' },
  { id: "sunroom-mono", label: "Red Hat Mono", kind: "mono", cssVar: "var(--font-t-sunroom-mono), ui-monospace, monospace" },
  { id: "aerogel-sans", label: "Plus Jakarta Sans", kind: "sans", cssVar: 'var(--font-t-aerogel-sans), "Segoe UI", sans-serif' },
  { id: "aerogel-mono", label: "Fragment Mono", kind: "mono", cssVar: "var(--font-t-aerogel-mono), ui-monospace, monospace" },
  { id: "bulletin-serif", label: "Instrument Serif", kind: "serif", cssVar: "var(--font-t-bulletin-serif), Georgia, serif" },
  { id: "bulletin-sans", label: "Bricolage Grotesque", kind: "sans", cssVar: 'var(--font-t-bulletin-sans), "Segoe UI", sans-serif' },
  { id: "understory-serif", label: "Lora", kind: "serif", cssVar: "var(--font-t-understory-serif), Georgia, serif" },
  { id: "understory-sans", label: "Karla", kind: "sans", cssVar: 'var(--font-t-understory-sans), "Segoe UI", sans-serif' },
  { id: "duotone-serif", label: "Bodoni Moda", kind: "serif", cssVar: 'var(--font-t-duotone-serif), "Bodoni MT", Georgia, serif' },
  { id: "cinder-sans", label: "Archivo", kind: "sans", cssVar: "var(--font-t-cinder-sans), Arial, sans-serif" },
  { id: "cinder-mono", label: "Space Mono", kind: "mono", cssVar: "var(--font-t-cinder-mono), ui-monospace, monospace" },
  { id: "aurora-sans", label: "Sora", kind: "sans", cssVar: 'var(--font-t-aurora-sans), "Segoe UI", sans-serif' },
  { id: "aurora-mono", label: "JetBrains Mono", kind: "mono", cssVar: "var(--font-t-aurora-mono), ui-monospace, monospace" },
  { id: "chrome-sans", label: "Chakra Petch", kind: "sans", cssVar: 'var(--font-t-chrome-sans), "Segoe UI", sans-serif' },
  { id: "neon-mono", label: "Orbitron", kind: "mono", cssVar: "var(--font-t-neon-mono), ui-monospace, monospace" },
  { id: "pixel-mono", label: "Silkscreen", kind: "mono", cssVar: "var(--font-t-pixel-mono), ui-monospace, monospace" },
  // Picker-only additions — curated for the kiosk's own use case rather than
  // introduced with a theme (see kiosk-theme.tsx's matching comment): text
  // faces chosen for distance legibility, mono chosen for display numerals.
  { id: "lexend", label: "Lexend", kind: "sans", cssVar: 'var(--font-t-lexend), "Segoe UI", sans-serif' },
  { id: "figtree", label: "Figtree", kind: "sans", cssVar: 'var(--font-t-figtree), "Segoe UI", sans-serif' },
  { id: "manrope", label: "Manrope", kind: "sans", cssVar: 'var(--font-t-manrope), "Segoe UI", sans-serif' },
  { id: "chivo-mono", label: "Chivo Mono", kind: "mono", cssVar: "var(--font-t-chivo-mono), ui-monospace, monospace" },
  { id: "system-sans", label: "System (Inter)", kind: "sans", cssVar: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif' },
  { id: "system-mono", label: "System (Cascadia)", kind: "mono", cssVar: '"Cascadia Code", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace' },
];

const KIOSK_FONT_IDS: ReadonlySet<KioskFontId> = new Set(KIOSK_FONTS.map((f) => f.id));

export const KIOSK_FONT_MAP: Record<KioskFontId, KioskFontOption> = Object.fromEntries(
  KIOSK_FONTS.map((f) => [f.id, f]),
) as Record<KioskFontId, KioskFontOption>;

/** What each theme actually sets today, MIRRORING the [data-kiosk-theme]
 *  blocks in globals.css — the fallback the picker falls back to and the
 *  "reset to theme default" target. Same caveat as KIOSK_THEME_SWATCHES
 *  above: this table WILL silently desync if a theme's --font-sans/--font-mono
 *  changes in globals.css and this table isn't updated alongside it — the
 *  live kiosk itself always resolves the CSS correctly either way (it never
 *  reads this table unless the device has no stored override), so a drift
 *  here is only visible in the Typeface picker's "default" labeling. Re-diff
 *  every [data-kiosk-theme="…"] block's font lines against this table after
 *  any globals.css font change.
 *
 *  Source lines (read 2026-08-04):
 *   default     → no [data-kiosk-theme] attribute at all (kiosk-theme.tsx:252
 *                 — "default" gets `undefined`), so it never matches the
 *                 [data-kiosk-theme] font rule and just gets the base stacks
 *                 (globals.css:44-45).
 *   terminal    → globals.css:416 (sans), :417 (mono) — both var(--font-t-terminal).
 *   journal     → globals.css:457-459 (sans intentionally unset, stays Inter),
 *                 :460 (mono = var(--font-t-journal)).
 *   lounge      → globals.css:489-491 (sans unset), :492 (mono = var(--font-t-lounge)).
 *   folio       → globals.css:522 (sans), :523 (mono).
 *   slate       → globals.css:551 (sans), :552 (mono).
 *   sunroom     → globals.css:633 (sans), :634 (mono).
 *   aerogel     → globals.css:910 (sans), :911 (mono).
 *   bulletin    → globals.css:953 (sans), :954 (mono = var(--font-t-bulletin-serif) —
 *                 Instrument Serif in the mono slot, by design; see :935-936).
 *   understory  → globals.css:982 (sans), :983 (mono = var(--font-t-understory-serif) —
 *                 Lora in the mono slot, same pattern as bulletin).
 *   duotone     → globals.css:1010-1012 (sans unset), :1013 (mono = var(--font-t-duotone-serif)).
 *   cinderblock → globals.css:1039 (sans), :1040 (mono).
 *   aurora      → globals.css:1081 (sans), :1082 (mono).
 *   chrome      → globals.css:1111 (sans), :1112-1116 (mono deliberately reuses
 *                 var(--font-t-aerogel-mono) — "no dedicated Chrome mono face
 *                 exists" per that comment, not a gap in this table).
 *   neon        → globals.css:1144-1146 (sans unset), :1147 (mono = var(--font-t-neon-mono)).
 *   pixel       → globals.css:1174-1177 (sans unset), :1178 (mono = var(--font-t-pixel-mono)).
 */
export const DEFAULT_THEME_FONTS: Record<KioskTheme, { sans: KioskFontId; mono: KioskFontId }> = {
  default: { sans: "system-sans", mono: "system-mono" },
  terminal: { sans: "terminal", mono: "terminal" },
  journal: { sans: "system-sans", mono: "journal" },
  lounge: { sans: "system-sans", mono: "lounge" },
  folio: { sans: "folio-sans", mono: "folio-mono" },
  slate: { sans: "slate-serif", mono: "slate-mono" },
  sunroom: { sans: "sunroom-sans", mono: "sunroom-mono" },
  aerogel: { sans: "aerogel-sans", mono: "aerogel-mono" },
  bulletin: { sans: "bulletin-sans", mono: "bulletin-serif" },
  understory: { sans: "understory-sans", mono: "understory-serif" },
  duotone: { sans: "system-sans", mono: "duotone-serif" },
  cinderblock: { sans: "cinder-sans", mono: "cinder-mono" },
  aurora: { sans: "aurora-sans", mono: "aurora-mono" },
  chrome: { sans: "chrome-sans", mono: "aerogel-mono" },
  neon: { sans: "system-sans", mono: "neon-mono" },
  pixel: { sans: "system-sans", mono: "pixel-mono" },
};

const STORAGE_KEY = "kiosk-fonts";
const CHANGE_EVENT = "kiosk-fonts-change";

export type KioskFontSlot = "sans" | "mono";
export type KioskFontOverrides = Partial<Record<KioskTheme, Partial<Record<KioskFontSlot, KioskFontId>>>>;

function isKioskFontId(v: unknown): v is KioskFontId {
  return typeof v === "string" && KIOSK_FONT_IDS.has(v as KioskFontId);
}

function isKioskTheme(v: unknown): v is KioskTheme {
  return typeof v === "string" && (KIOSK_THEMES as readonly string[]).includes(v);
}

/** Defensive parse: a corrupt or hand-edited localStorage blob must not throw
 *  and must not brick the kiosk (there's a src/app/kiosk/error.tsx boundary,
 *  but font resolution runs on every paint and shouldn't depend on it). Any
 *  key that isn't a real theme, or any slot value that isn't a real font id,
 *  is dropped rather than trusted — one bad entry doesn't invalidate the rest. */
function readOverrides(): KioskFontOverrides {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const result: KioskFontOverrides = {};
  for (const [themeKey, slots] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isKioskTheme(themeKey)) continue;
    if (typeof slots !== "object" || slots === null) continue;
    const clean: Partial<Record<KioskFontSlot, KioskFontId>> = {};
    const sans = (slots as Record<string, unknown>).sans;
    const mono = (slots as Record<string, unknown>).mono;
    if (isKioskFontId(sans)) clean.sans = sans;
    if (isKioskFontId(mono)) clean.mono = mono;
    if (clean.sans || clean.mono) result[themeKey] = clean;
  }
  return result;
}

function writeOverrides(overrides: KioskFontOverrides): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // non-persistent is fine (private mode) — the broadcast below still fires
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Set (or, with fontId null, clear) one theme's override for one slot.
 *  Clearing falls back to DEFAULT_THEME_FONTS[theme][slot]. Storage failures
 *  still broadcast, matching setKioskTheme's private-mode behavior. */
export function setKioskThemeFont(theme: KioskTheme, slot: KioskFontSlot, fontId: KioskFontId | null): void {
  const overrides = readOverrides();
  const current = { ...(overrides[theme] ?? {}) };
  if (fontId === null) {
    delete current[slot];
  } else {
    current[slot] = fontId;
  }
  const next: KioskFontOverrides = { ...overrides };
  if (current.sans || current.mono) {
    next[theme] = current;
  } else {
    delete next[theme];
  }
  writeOverrides(next);
}

/** Clear both slots for one theme in one write (the panel's "Reset to theme
 *  default" control) rather than two separate setKioskThemeFont calls, which
 *  would otherwise broadcast — and cost a re-render — twice. */
export function clearKioskThemeFonts(theme: KioskTheme): void {
  const overrides = readOverrides();
  if (!(theme in overrides)) return;
  const next = { ...overrides };
  delete next[theme];
  writeOverrides(next);
}

/** The resolved { sans, mono } font ids for a given theme: stored override
 *  per slot if present, else DEFAULT_THEME_FONTS[theme]'s own id for that
 *  slot. SSR-safe seed is the theme default (never storage), then hydrates
 *  from localStorage in an effect and live-updates on setKioskThemeFont /
 *  clearKioskThemeFonts, mirroring useKioskTheme's pattern exactly. */
export function useKioskFonts(theme: KioskTheme): { sans: KioskFontId; mono: KioskFontId } {
  const [fonts, setFonts] = useState<{ sans: KioskFontId; mono: KioskFontId }>(DEFAULT_THEME_FONTS[theme]);

  useEffect(() => {
    const resolve = () => {
      const overrides = readOverrides()[theme];
      const fallback = DEFAULT_THEME_FONTS[theme];
      setFonts({
        sans: overrides?.sans ?? fallback.sans,
        mono: overrides?.mono ?? fallback.mono,
      });
    };
    resolve();
    window.addEventListener(CHANGE_EVENT, resolve);
    return () => window.removeEventListener(CHANGE_EVENT, resolve);
  }, [theme]);

  return fonts;
}

/** The CSS font-family value for a resolved font id — what actually gets
 *  assigned to --font-sans/--font-mono/style.fontFamily. */
export function kioskFontValue(id: KioskFontId): string {
  return KIOSK_FONT_MAP[id].cssVar;
}
