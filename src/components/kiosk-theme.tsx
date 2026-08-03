"use client";

/* Device-local theme scope for /kiosk. A theme here is a full IDENTITY —
   palette, typefaces, corner geometry, texture — not a recolor: the
   [data-kiosk-theme] blocks in globals.css re-declare the Tailwind color
   AND font tokens inside this scope, so every kiosk descendant (both
   layouts, night overlay, pin pad) changes worlds without any component
   knowing themes exist. The per-tablet choice lives in localStorage,
   exactly like the layout: same server, different rooms, different moods.

   Fonts are loaded with next/font (build-time, self-hosted, zero runtime
   deps) and exposed as CSS variables on the scope div; each theme's CSS
   maps --font-sans/--font-mono onto the variables it wants. Every theme
   font is `preload: false`: @font-face only downloads a face when text on
   screen actually uses it, so a tablet pays for its OWN theme's fonts and
   nothing else — 20 families defined, one or two ever fetched.

   Cross-component sync is a window CustomEvent rather than context: the
   switcher (page.tsx, inside the scope) and the scope itself (layout.tsx,
   above the page) have no convenient shared ancestor to hang a provider on
   without converting the kiosk layout to a client boundary wholesale. */

import { useEffect, useState } from "react";
import {
  Archivo,
  Bodoni_Moda,
  Bricolage_Grotesque,
  Chakra_Petch,
  Courier_Prime,
  Fragment_Mono,
  Fraunces,
  IBM_Plex_Mono,
  Instrument_Serif,
  JetBrains_Mono,
  Karla,
  Lora,
  Newsreader,
  Orbitron,
  Plus_Jakarta_Sans,
  Quicksand,
  Red_Hat_Mono,
  Silkscreen,
  Sora,
  Source_Serif_4,
  Space_Mono,
  Spline_Sans_Mono,
  Work_Sans,
} from "next/font/google";
import { cn } from "@/lib/utils";

// next/font calls are build-time macros: every argument must be a literal
// object (no spread, no variables) or SWC rejects it with "Unexpected spread".

// Original trio
const fTerminal = IBM_Plex_Mono({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500"], variable: "--font-t-terminal" });
const fJournal = Newsreader({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-journal" });
const fLounge = Fraunces({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-lounge" });
// Light & calm
const fFolioSans = Work_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-folio-sans" });
const fFolioMono = Spline_Sans_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-folio-mono" });
const fSlateSerif = Source_Serif_4({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-slate-serif" });
const fSlateMono = Courier_Prime({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-t-slate-mono" });
const fSunroomSans = Quicksand({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-sunroom-sans" });
const fSunroomMono = Red_Hat_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-sunroom-mono" });
const fAerogelSans = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-aerogel-sans" });
const fAerogelMono = Fragment_Mono({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-t-aerogel-mono" });
// Warm & editorial
const fBulletinSerif = Instrument_Serif({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-t-bulletin-serif" });
const fBulletinSans = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-bulletin-sans" });
const fUnderstorySerif = Lora({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-understory-serif" });
const fUnderstorySans = Karla({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-understory-sans" });
const fDuotoneSerif = Bodoni_Moda({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-duotone-serif" });
const fCinderSans = Archivo({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-cinder-sans" });
const fCinderMono = Space_Mono({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-t-cinder-mono" });
// Dark & expressive
const fAuroraSans = Sora({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-aurora-sans" });
const fAuroraMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-aurora-mono" });
const fChromeSans = Chakra_Petch({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500"], variable: "--font-t-chrome-sans" });
const fNeonMono = Orbitron({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-t-neon-mono" });
const fPixelMono = Silkscreen({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-t-pixel-mono" });

const FONT_VARIABLE_CLASSES = [
  fTerminal, fJournal, fLounge,
  fFolioSans, fFolioMono, fSlateSerif, fSlateMono, fSunroomSans, fSunroomMono, fAerogelSans, fAerogelMono,
  fBulletinSerif, fBulletinSans, fUnderstorySerif, fUnderstorySans, fDuotoneSerif, fCinderSans, fCinderMono,
  fAuroraSans, fAuroraMono, fChromeSans, fNeonMono, fPixelMono,
].map((f) => f.variable);

export type KioskTheme =
  | "default"
  | "terminal"
  | "journal"
  | "lounge"
  | "folio"
  | "slate"
  | "sunroom"
  | "aerogel"
  | "bulletin"
  | "understory"
  | "duotone"
  | "cinderblock"
  | "aurora"
  | "chrome"
  | "neon"
  | "pixel";

export const KIOSK_THEMES: readonly KioskTheme[] = [
  "default", "terminal", "journal", "lounge",
  "folio", "slate", "sunroom", "aerogel",
  "bulletin", "understory", "duotone", "cinderblock",
  "aurora", "chrome", "neon", "pixel",
];

export const KIOSK_THEME_LABELS: Record<KioskTheme, string> = {
  default: "Default",
  terminal: "Terminal",
  journal: "Journal",
  lounge: "Lounge",
  folio: "Folio",
  slate: "Slate & Paper",
  sunroom: "Sunroom",
  aerogel: "Aerogel",
  bulletin: "Bulletin",
  understory: "Understory",
  duotone: "Duotone Press",
  cinderblock: "Cinderblock",
  aurora: "Aurora",
  chrome: "Chrome Panel",
  neon: "Neon Static",
  pixel: "Pixel Forecast",
};

/** The catalog's own taxonomy — the same families the font/CSS blocks are
 *  organized by. The appearance picker renders one chip row per group. */
export const KIOSK_THEME_GROUPS: readonly { label: string; themes: readonly KioskTheme[] }[] = [
  { label: "core", themes: ["default", "terminal", "journal", "lounge"] },
  { label: "light & calm", themes: ["folio", "slate", "sunroom", "aerogel"] },
  { label: "warm & editorial", themes: ["bulletin", "understory", "duotone", "cinderblock"] },
  { label: "dark & expressive", themes: ["aurora", "chrome", "neon", "pixel"] },
];

/** The single source of truth for "which themes have a light (pale) ground" —
 *  must stay in sync with each theme's `color-scheme: light` declaration in
 *  globals.css (9 of 16 themes). Any consumer that needs to branch on ground
 *  lightness (e.g. KioskSky's ambient-opacity cap) should import this set
 *  rather than keep its own copy — a second independent restatement is how
 *  a newly added light theme silently gets treated as dark. */
export const KIOSK_LIGHT_THEMES: ReadonlySet<KioskTheme> = new Set([
  "journal",
  "folio",
  "slate",
  "sunroom",
  "aerogel",
  "bulletin",
  "understory",
  "duotone",
  "cinderblock",
]);

/** Ground + accent per theme, MIRRORING the [data-kiosk-theme] blocks in
 *  globals.css — the one place theme colors are legitimately duplicated,
 *  so the picker chips can preview an identity before it's applied (CSS
 *  vars can't cross scopes to do this). Update alongside the CSS.
 *
 *  This mirror WILL silently desync if you don't: a contrast or palette
 *  edit to a theme's --color-bg/--color-accent in globals.css has nothing
 *  else checking it against this table, and the live kiosk itself resolves
 *  the CSS vars correctly either way — only the picker's preview chips lie,
 *  so a drift here is invisible unless someone opens the appearance picker
 *  and compares it against the theme actually applying. Re-run the 16-theme
 *  comparison (diff this table's bg/accent against each
 *  [data-kiosk-theme="…"] block) after any globals.css palette change. */
export const KIOSK_THEME_SWATCHES: Record<KioskTheme, { bg: string; accent: string }> = {
  default: { bg: "#070b11", accent: "#5eead4" },
  terminal: { bg: "#000000", accent: "#4ade80" },
  journal: { bg: "#f5f2ec", accent: "#9f1239" },
  lounge: { bg: "#120b06", accent: "#fb923c" },
  folio: { bg: "#ffffff", accent: "#0033cc" },
  slate: { bg: "#e7e4dc", accent: "#8a3b2f" },
  sunroom: { bg: "#e3e7ee", accent: "#3964bf" },
  aerogel: { bg: "#eef1f6", accent: "#4f5fd8" },
  bulletin: { bg: "#faf6ee", accent: "#2a52d4" },
  understory: { bg: "#eef1e4", accent: "#a95630" },
  duotone: { bg: "#f5ede0", accent: "#c0400c" },
  cinderblock: { bg: "#f2ede1", accent: "#c63910" },
  aurora: { bg: "#0b0c14", accent: "#9d7bff" },
  chrome: { bg: "#26292e", accent: "#ff9f1c" },
  neon: { bg: "#16102e", accent: "#ff5ec4" },
  pixel: { bg: "#10142a", accent: "#ffd23f" },
};

const STORAGE_KEY = "kiosk-theme";
const CHANGE_EVENT = "kiosk-theme-change";

function isKioskTheme(v: unknown): v is KioskTheme {
  return typeof v === "string" && (KIOSK_THEMES as readonly string[]).includes(v);
}

/** Persist + broadcast a theme choice. Storage failures (private mode) still
 *  broadcast — the choice just won't survive a reload. */
export function setKioskTheme(theme: KioskTheme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // non-persistent is fine
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: theme }));
}

/** The current theme: SSR-safe "default" seed, then ?theme= override (wins
 *  for the session, never persisted — it exists for testing/screenshots),
 *  then the stored device preference; live-updates on setKioskTheme. */
export function useKioskTheme(): KioskTheme {
  const [theme, setTheme] = useState<KioskTheme>("default");

  useEffect(() => {
    const override = new URLSearchParams(window.location.search).get("theme");
    if (isKioskTheme(override)) {
      setTheme(override);
    } else {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isKioskTheme(stored)) setTheme(stored);
    }
    const onChange = (e: Event) => {
      const next = (e as CustomEvent).detail as unknown;
      if (isKioskTheme(next)) setTheme(next);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  return theme;
}

/** The kiosk shell div (moved here from kiosk/layout.tsx so the layout stays
 *  a server component and keeps its metadata exports). Carries the safe-area
 *  padding for standalone-PWA mode, the theme attribute, and every theme's
 *  font variable (variables are free; faces download only on use). */
export function KioskThemeScope({ children }: { children: React.ReactNode }) {
  const theme = useKioskTheme();
  return (
    <div
      data-kiosk-theme={theme === "default" ? undefined : theme}
      // kiosk-dense: the wall-tablet type/density scope (globals.css, end of
      // file). It belongs on this div rather than page.tsx's inner one so it
      // also reaches the night overlay and the PIN pad, which render outside
      // that column — everything on this surface is read from 2-3m, not just
      // the parts inside the main layout.
      // overflow-x-CLIP, not -hidden: `hidden` on one axis force-promotes the
      // other from `visible` to `auto` (CSS Overflow 3's visible-forcing rule),
      // which made this div a scroll container and silently broke
      // `position: sticky` on the kiosk header — it scrolled away with the page
      // instead of pinning (measured: top 16px → -195px). `clip` is exempt from
      // that rule, so overflow-y stays `visible`, the sticky containing block
      // resolves to the viewport, and the horizontal clipping is unchanged.
      className={cn("kiosk-dense min-h-screen bg-bg overflow-x-clip", ...FONT_VARIABLE_CLASSES)}
      style={{
        // isolate: gives this div its own stacking context so KioskSky's
        // z-index:-1 layer paints ABOVE this ground color but below content.
        // Without it, CSS painting order puts negative-z descendants behind
        // the shared context's in-flow backgrounds — invisible by construction.
        isolation: "isolate",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {children}
    </div>
  );
}
