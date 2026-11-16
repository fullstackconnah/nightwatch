"use client";

/* Per-theme accent choice for /kiosk: one of six fixed swatches, or the theme's
   own accent. The panel stores a swatch NAME per theme, never a hex, so a swatch
   is valid on every theme and each theme just uses the half that matches its
   ground. State pattern copies kiosk-fonts.ts (STORAGE_KEY + CHANGE_EVENT + a
   persist-then-broadcast setter + a hook that seeds the default and hydrates).
   Per device and per theme; nothing is sent to the server. */

import { useEffect, useState } from "react";
import type { KioskTheme } from "@/components/kiosk/kiosk-theme";

export type KioskAccentId = "harbour" | "lagoon" | "fern" | "iris" | "orchid" | "clay";

/** One ground's pair: `accent` for text and marks, `dim` for the dimmer step. */
export interface AccentHalf {
  accent: string;
  dim: string;
}

export interface KioskAccentSwatch {
  id: KioskAccentId;
  label: string;
  light: AccentHalf;
  dark: AccentHalf;
}

/** Order is the chip order. Every half clears 4.5:1 on every ground it meets
 *  (src/lib/kiosk-accent.test.ts for the fixed themes, scripts/sunroom-contrast.mjs
 *  for Sunroom's whole ramp). Change a hex only with both gates green. */
export const KIOSK_ACCENTS: readonly KioskAccentSwatch[] = [
  { id: "harbour", label: "Harbour", light: { accent: "#21488c", dim: "#204688" }, dark: { accent: "#c3d4f1", dim: "#83aaef" } },
  { id: "lagoon", label: "Lagoon", light: { accent: "#0e5251", dim: "#0c4543" }, dark: { accent: "#60e3df", dim: "#10c4be" } },
  { id: "fern", label: "Fern", light: { accent: "#1e5632", dim: "#1b4b2b" }, dark: { accent: "#a5dfb8", dim: "#48d577" } },
  { id: "iris", label: "Iris", light: { accent: "#5b2bae", dim: "#592aa9" }, dark: { accent: "#dccef3", dim: "#bc9cf1" } },
  { id: "orchid", label: "Orchid", light: { accent: "#832367", dim: "#7b2160" }, dark: { accent: "#f0c6e4", dim: "#ed87ce" } },
  { id: "clay", label: "Clay", light: { accent: "#7a381c", dim: "#72351b" }, dark: { accent: "#efc9b9", dim: "#ec946f" } },
];

const ACCENT_BY_ID = new Map(KIOSK_ACCENTS.map((s) => [s.id, s]));

export function kioskAccentSwatch(id: KioskAccentId): KioskAccentSwatch {
  return ACCENT_BY_ID.get(id)!;
}

/** Which half each theme uses. Sunroom is light by day and dark at night: the
 *  ramp picks the half (sunroom-light.ts), so it is never read through here for
 *  a colour. Typed as a Record so a new theme cannot be added without a ground. */
export const KIOSK_THEME_GROUND: Record<KioskTheme, "light" | "dark" | "sunroom"> = {
  default: "dark",
  terminal: "dark",
  lounge: "dark",
  aurora: "dark",
  chrome: "dark",
  neon: "dark",
  pixel: "dark",
  journal: "light",
  folio: "light",
  slate: "light",
  aerogel: "light",
  bulletin: "light",
  understory: "light",
  duotone: "light",
  cinderblock: "light",
  sunroom: "sunroom",
};

const STORAGE_KEY = "kiosk-accent";
const CHANGE_EVENT = "kiosk-accent-change";

export type KioskAccentChoices = Partial<Record<KioskTheme, KioskAccentId>>;

function isAccentId(v: unknown): v is KioskAccentId {
  return typeof v === "string" && ACCENT_BY_ID.has(v as KioskAccentId);
}

function isKioskTheme(v: unknown): v is KioskTheme {
  return typeof v === "string" && Object.hasOwn(KIOSK_THEME_GROUND, v);
}

/** Set only while a write has failed (private mode, blocked storage): the session's
 *  choices live here so a pick still holds and a later read sees it. */
let memory: KioskAccentChoices | null = null;

/** Defensive parse, like kiosk-fonts.ts: corrupt JSON, a non-object, an unknown
 *  theme key or an unknown swatch id is dropped, never trusted or thrown. */
export function readKioskAccents(): KioskAccentChoices {
  if (memory) return memory;
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
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const result: KioskAccentChoices = {};
  for (const [theme, id] of Object.entries(parsed)) {
    if (isKioskTheme(theme) && isAccentId(id)) result[theme] = id;
  }
  return result;
}

/** Set (or, with id null, clear) one theme's accent. Clearing deletes the key.
 *  Storage failures still broadcast, so the choice holds for the session. */
export function setKioskThemeAccent(theme: KioskTheme, id: KioskAccentId | null): void {
  const next = { ...readKioskAccents() };
  if (id === null) delete next[theme];
  else next[theme] = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    memory = null;
  } catch {
    memory = next; // non-persistent is fine (private mode): the choice holds for the session
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** The chosen swatch id for a theme, or null for Theme default. SSR-safe seed is
 *  null (never storage), then it hydrates and live-updates. No cross-tab sync. */
export function useKioskAccent(theme: KioskTheme): KioskAccentId | null {
  const [id, setId] = useState<KioskAccentId | null>(null);
  useEffect(() => {
    const resolve = () => setId(readKioskAccents()[theme] ?? null);
    resolve();
    window.addEventListener(CHANGE_EVENT, resolve);
    return () => window.removeEventListener(CHANGE_EVENT, resolve);
  }, [theme]);
  return id;
}
