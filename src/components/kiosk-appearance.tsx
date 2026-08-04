"use client";

/* The personalisation panel for the elevated kiosk: layout + theme + (new)
   per-theme typeface, behind a tab strip so more sections (a "Widgets" tab
   is coming next) can be added without restructuring this component again.
   Rebuilt from the impeccable layout assessment, which found the old
   version's failures in order of severity: an unwrappable 16-button row
   (guaranteed horizontal overflow), no panel anchoring between two real
   panels, sixteen identical text pills carrying zero visual information
   about radically different identities, the catalog's own four-family
   taxonomy flattened away, and an active state too quiet to pick out of 16
   siblings at kiosk distance.

   Answers, in the same order: chips wrap inside each family row; the whole
   control lives in one .panel (DESIGN.md's segmented-control idiom for the
   layout pair — padded panel-2 track, not per-button borders); every theme
   chip leads with a swatch of its real ground + accent (KIOSK_THEME_SWATCHES);
   the KIOSK_THEME_GROUPS families become microlabel-headed rows (tight gap-2
   inside a family, roomier gap-4 between families — rhythm, not monotony);
   the active chip gets a full-strength accent ring on top of the tint.

   redesign-06 §5 repurposes the stored "glance"/"standard" pair rather than
   replacing it: the device-local choice still decides between a merged,
   auto-returning surface and a pinned one, it just isn't a straight layout
   swap anymore (kiosk-surface.tsx handles both from one component). "Auto"
   is the new default meaning of "glance" — the surface rests as the wall
   clock and animates to the full view on any touch, then idles back —
   while "Always full" ("standard") opts a bench/desk device permanently
   into the compact view with no auto-return. Same two-option segmented
   control, same stored values, just relabelled so the copy matches what
   picking each one now actually does.

   The tab strip below is a plain useState switch, not a router — this panel
   only ever exists inside the elevated block, nothing deep-links into a
   single tab, and a fourth "Widgets" tab later is just one more entry in
   PANEL_TABS plus one more branch in the tabpanel switch. Tabs get real
   role="tablist"/"tab"/aria-selected/aria-controls semantics (this is
   genuinely tabbed content, unlike the two binary choices below, which stay
   aria-pressed), but are STYLED like the existing segmented control (padded
   panel-2 track) so the whole panel still reads as one family of controls. */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  KIOSK_THEME_GROUPS,
  KIOSK_THEME_LABELS,
  KIOSK_THEME_SWATCHES,
  setKioskTheme,
  useKioskTheme,
  type KioskTheme,
} from "@/components/kiosk-theme";
import {
  DEFAULT_THEME_FONTS,
  KIOSK_FONTS,
  KIOSK_FONT_MAP,
  clearKioskThemeFonts,
  setKioskThemeFont,
  useKioskFonts,
  type KioskFontId,
  type KioskFontOption,
  type KioskFontSlot,
} from "@/lib/kiosk-fonts";

export type KioskLayoutChoice = "standard" | "glance";

type PanelTabId = "appearance" | "typeface";

const PANEL_TABS: readonly { id: PanelTabId; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "typeface", label: "Typeface" },
];

function ThemeChip({ theme, active }: { theme: KioskTheme; active: boolean }) {
  const swatch = KIOSK_THEME_SWATCHES[theme];
  return (
    <button
      type="button"
      onClick={() => setKioskTheme(theme)}
      aria-pressed={active}
      className={cn(
        "flex h-11 items-center gap-2 rounded-md border px-3 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-accent",
        active
          ? "border-accent bg-accent/10 text-ink ring-1 ring-accent"
          : "border-line text-ink-dim hover:border-line-bright hover:text-ink",
      )}
    >
      {/* The chip's one job: show the identity before it's applied. Ground
          disc with the accent as a setting-sun dot; hairline keeps light
          swatches visible on the dark panel. */}
      <span
        aria-hidden
        className="relative h-5 w-5 shrink-0 rounded-full border border-line-bright"
        style={{ backgroundColor: swatch.bg }}
      >
        <span
          className="absolute bottom-0 right-0 h-2 w-2 rounded-full"
          style={{ backgroundColor: swatch.accent }}
        />
      </span>
      {KIOSK_THEME_LABELS[theme]}
    </button>
  );
}

/** A font chip previews itself IN its own face — the same "show the identity
 *  before it's applied" thesis ThemeChip uses a swatch for, except a
 *  typeface's swatch IS its own label rendered in its own font-family. */
function FontChip({
  option,
  active,
  isDefault,
  onSelect,
}: {
  option: KioskFontOption;
  active: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex h-11 items-center gap-2 rounded-md border px-3 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-accent",
        active
          ? "border-accent bg-accent/10 text-ink ring-1 ring-accent"
          : "border-line text-ink-dim hover:border-line-bright hover:text-ink",
      )}
    >
      <span style={{ fontFamily: option.cssVar }}>{option.label}</span>
      {isDefault && <span className="text-ink-dim">· default</span>}
    </button>
  );
}

/** Catalog entries for one slot, filtered by kind — "Text" shows sans+serif
 *  faces, "Numerals" shows mono faces. Unions in the theme's own default for
 *  that slot even when it's off-kind: five themes (journal, lounge, bulletin,
 *  understory, duotone) deliberately plug a SERIF face into the numerals
 *  slot for an editorial look (see kiosk-fonts.ts's DEFAULT_THEME_FONTS
 *  comment) — without this union, opening Numerals on Bulletin would make
 *  its own active default vanish from the list it's supposedly chosen from. */
function optionsForSlot(slot: KioskFontSlot, theme: KioskTheme): readonly KioskFontOption[] {
  const kinds: readonly KioskFontOption["kind"][] = slot === "sans" ? ["sans", "serif"] : ["mono"];
  const base = KIOSK_FONTS.filter((f) => kinds.includes(f.kind));
  const defaultId = DEFAULT_THEME_FONTS[theme][slot];
  if (base.some((f) => f.id === defaultId)) return base;
  return [...base, KIOSK_FONT_MAP[defaultId]];
}

function FontSlotSection({
  slotLabel,
  slot,
  theme,
  activeId,
}: {
  slotLabel: string;
  slot: KioskFontSlot;
  theme: KioskTheme;
  activeId: KioskFontId;
}) {
  const defaultId = DEFAULT_THEME_FONTS[theme][slot];
  const options = optionsForSlot(slot, theme);

  return (
    <div className="flex flex-col gap-2">
      <span className="microlabel">{slotLabel}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <FontChip
            key={option.id}
            option={option}
            active={option.id === activeId}
            isDefault={option.id === defaultId}
            // Picking the chip that IS the default clears the override
            // instead of writing an explicit-but-identical one, so "undo"
            // for a single slot is just "tap the chip marked default" —
            // no separate control needed for the single-slot case.
            onSelect={() => setKioskThemeFont(theme, slot, option.id === defaultId ? null : option.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TypefaceTab({ theme }: { theme: KioskTheme }) {
  const fonts = useKioskFonts(theme);

  return (
    <div className="flex flex-col gap-4">
      <p className="-mt-1 text-2xs text-ink-faint">
        Applies to {KIOSK_THEME_LABELS[theme]} only. Every theme keeps its own faces — this
        changes them for this device, not for the theme everywhere.
      </p>
      <FontSlotSection slotLabel="text" slot="sans" theme={theme} activeId={fonts.sans} />
      <FontSlotSection slotLabel="numerals" slot="mono" theme={theme} activeId={fonts.mono} />
      <div>
        <button
          type="button"
          onClick={() => clearKioskThemeFonts(theme)}
          className="flex h-11 items-center rounded-md border border-line px-3 text-xs text-ink-dim outline-none transition hover:border-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
        >
          Reset to theme default
        </button>
      </div>
    </div>
  );
}

export function KioskAppearance({
  layout,
  onLayoutChange,
}: {
  layout: KioskLayoutChoice;
  onLayoutChange: (next: KioskLayoutChoice) => void;
}) {
  const theme = useKioskTheme();
  const [activeTab, setActiveTab] = useState<PanelTabId>("appearance");

  return (
    <section className="panel flex w-full flex-col gap-4 p-4">
      <div role="tablist" aria-label="Personalisation" className="flex rounded-lg bg-panel-2 p-1">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            id={`kiosk-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`kiosk-tabpanel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "h-11 rounded-md px-5 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-accent",
              activeTab === tab.id ? "bg-panel text-ink shadow-sm ring-1 ring-line-bright" : "text-ink-dim hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "appearance" && (
        <div id="kiosk-tabpanel-appearance" role="tabpanel" aria-labelledby="kiosk-tab-appearance" className="flex flex-col gap-4">
          {/* Layout: the binary decision gets the system's real segmented
              control — a padded panel-2 track — visually distinct from the
              16-way chip field below. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="microlabel">appearance</span>
            <div className="flex rounded-lg bg-panel-2 p-1" role="group" aria-label="Kiosk auto-return">
              {(["glance", "standard"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onLayoutChange(option)}
                  aria-pressed={layout === option}
                  className={cn(
                    "h-11 rounded-md px-5 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-accent",
                    layout === option ? "bg-panel text-ink shadow-sm ring-1 ring-line-bright" : "text-ink-dim hover:text-ink",
                  )}
                >
                  {option === "glance" ? "Auto" : "Always full"}
                </button>
              ))}
            </div>
          </div>
          <p className="-mt-1 text-2xs text-ink-faint">
            Auto rests as the wall clock and wakes to the full view on a touch. Always full stays on the
            full view and never returns on its own — for a bench or desk device.
          </p>

          <div aria-hidden className="h-px bg-line" />

          <div className="flex flex-col gap-4">
            {KIOSK_THEME_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-2">
                <span className="microlabel">{group.label}</span>
                <div className="flex flex-wrap gap-2">
                  {group.themes.map((t) => (
                    <ThemeChip key={t} theme={t} active={theme === t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "typeface" && (
        <div id="kiosk-tabpanel-typeface" role="tabpanel" aria-labelledby="kiosk-tab-typeface">
          <TypefaceTab theme={theme} />
        </div>
      )}
    </section>
  );
}
