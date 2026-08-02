"use client";

/* Device-local theme scope for /kiosk. A theme here is a full IDENTITY —
   palette, typefaces, corner geometry, texture — not a recolor: the
   [data-kiosk-theme] blocks in globals.css re-declare the Tailwind color
   AND font tokens inside this scope, so every kiosk descendant (both
   layouts, night overlay, pin pad) changes worlds without any component
   knowing themes exist. The per-tablet choice lives in localStorage,
   exactly like the layout: same server, different rooms, different moods.

   Fonts are loaded here with next/font (build-time, self-hosted, zero
   runtime deps) and exposed as CSS variables on the scope div; each theme's
   CSS maps --font-sans/--font-mono onto the variable it wants. Loading all
   three families costs a few tens of KB of woff2 — acceptable for an
   always-on wall surface that never re-downloads them.

   Cross-component sync is a window CustomEvent rather than context: the
   switcher (page.tsx, inside the scope) and the scope itself (layout.tsx,
   above the page) have no convenient shared ancestor to hang a provider on
   without converting the kiosk layout to a client boundary wholesale. */

import { useEffect, useState } from "react";
import { IBM_Plex_Mono, Newsreader, Fraunces } from "next/font/google";
import { cn } from "@/lib/utils";

// Terminal: a true engineer's mono with enough weight range for the clock.
const themeTerminalFont = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-theme-terminal",
  display: "swap",
});

// Journal: an editorial text serif whose old-style numerals make the clock
// and temperatures read like a broadsheet masthead.
const themeJournalFont = Newsreader({
  subsets: ["latin"],
  variable: "--font-theme-journal",
  display: "swap",
});

// Lounge: a soft display serif — warm, round, a little indulgent.
const themeLoungeFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-theme-lounge",
  display: "swap",
});

export type KioskTheme = "default" | "terminal" | "journal" | "lounge";

export const KIOSK_THEMES: readonly KioskTheme[] = ["default", "terminal", "journal", "lounge"];

const STORAGE_KEY = "kiosk-theme";
const CHANGE_EVENT = "kiosk-theme-change";

function isKioskTheme(v: unknown): v is KioskTheme {
  return v === "default" || v === "terminal" || v === "journal" || v === "lounge";
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
 *  padding for standalone-PWA mode, the theme attribute, and the theme font
 *  variables. */
export function KioskThemeScope({ children }: { children: React.ReactNode }) {
  const theme = useKioskTheme();
  return (
    <div
      data-kiosk-theme={theme === "default" ? undefined : theme}
      className={cn(
        "min-h-screen bg-bg overflow-x-hidden",
        themeTerminalFont.variable,
        themeJournalFont.variable,
        themeLoungeFont.variable,
      )}
      style={{
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
