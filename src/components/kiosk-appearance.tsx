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
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import {
  KIOSK_WIDGETS,
  KIOSK_WIDGET_MAP,
  resetKioskWidgetLayout,
  setKioskWidgetLayout,
  useKioskWidgetAvailability,
  useKioskWidgetLayout,
  type KioskScreen,
  type KioskWidgetDef,
  type KioskWidgetId,
  type KioskWidgetRequirement,
} from "@/lib/kiosk-widgets";

export type KioskLayoutChoice = "standard" | "glance";

type PanelTabId = "appearance" | "typeface" | "widgets";

const PANEL_TABS: readonly { id: PanelTabId; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "typeface", label: "Typeface" },
  { id: "widgets", label: "Widgets" },
];

/* ── widgets tab ─────────────────────────────────────────────────────────── */

/** Reordering is BUTTONS, never HTML5 drag-and-drop. This panel is only ever
 *  reached from a wall tablet in an elevated session, and dragging a list item
 *  with a fingertip on a 1024px touch screen — while the surface underneath
 *  treats stray pointer movement as interaction — is a worse experience than
 *  two unambiguous taps. Up/down also stays operable by keyboard for free. */
function WidgetRow({
  def,
  index,
  total,
  onMove,
  onRemove,
}: {
  def: KioskWidgetDef;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onRemove: (id: KioskWidgetId) => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{def.label}</span>
        <span className="block truncate text-2xs text-ink-faint">{def.blurb}</span>
      </span>
      <button
        type="button"
        onClick={() => onMove(index, index - 1)}
        disabled={index === 0}
        aria-label={`Move ${def.label} up`}
        className={ROW_BUTTON}
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onMove(index, index + 1)}
        disabled={index === total - 1}
        aria-label={`Move ${def.label} down`}
        className={ROW_BUTTON}
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onRemove(def.id)}
        aria-label={`Remove ${def.label}`}
        className={ROW_BUTTON}
      >
        <X size={16} aria-hidden />
      </button>
    </li>
  );
}

/* 44px floor rather than the 56px the wall surface itself uses: these sit in
   a dense list three-to-a-row inside an already-scrolling admin panel, where
   56px targets would push the list past a screen. 44 is still above the touch
   floor the audit set for non-primary controls. */
const ROW_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-30";

function WidgetScreenSection({
  screen,
  label,
  hint,
  ids,
  availability,
}: {
  screen: KioskScreen;
  label: string;
  hint: string;
  ids: readonly KioskWidgetId[];
  availability: Record<KioskWidgetRequirement, boolean>;
}) {
  const placed = ids.map((id) => KIOSK_WIDGET_MAP.get(id)).filter((d): d is KioskWidgetDef => Boolean(d));
  // A widget already on THIS screen is not offerable again; one sitting on the
  // other screen still is — the two lists are independent placements, not a
  // single pool being split.
  const addable = KIOSK_WIDGETS.filter((w) => w.allow.includes(screen) && !ids.includes(w.id));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setKioskWidgetLayout(screen, next);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="microlabel">{label}</span>
      <p className="text-2xs text-ink-faint">{hint}</p>

      {placed.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-3 text-xs text-ink-dim">
          Nothing on this screen yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {placed.map((def, i) => (
            <WidgetRow
              key={def.id}
              def={def}
              index={i}
              total={placed.length}
              onMove={move}
              onRemove={(id) => setKioskWidgetLayout(screen, ids.filter((x) => x !== id))}
            />
          ))}
        </ul>
      )}

      {addable.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {addable.map((w) => {
            // `requires` names a data source, not a hard gate — an unavailable
            // one is still addable on purpose (Home Assistant may just be
            // briefly unreachable), it simply says so rather than silently
            // rendering an empty pane the user can't explain.
            const unavailable = w.requires ? !availability[w.requires] : false;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setKioskWidgetLayout(screen, [...ids, w.id])}
                title={w.blurb}
                className="flex h-11 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-ink-dim outline-none transition hover:border-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
              >
                <Plus size={14} aria-hidden />
                {w.label}
                {unavailable && <span className="microlabel !text-warn">no data</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WidgetsTab() {
  const layout = useKioskWidgetLayout();
  const availability = useKioskWidgetAvailability();

  return (
    <div className="flex flex-col gap-5">
      <WidgetScreenSection
        screen="glance"
        label="glance band"
        hint="The wide band under the clock rotates through these, one at a time. Controls stay put below it — only the things you read rotate."
        ids={layout.glance}
        availability={availability}
      />
      <div aria-hidden className="h-px bg-line" />
      <WidgetScreenSection
        screen="full"
        label="full view"
        hint="Extra panels above the hub. The hub and weather band are always shown."
        ids={layout.full}
        availability={availability}
      />
      <div>
        <button
          type="button"
          onClick={resetKioskWidgetLayout}
          className="h-11 rounded-md border border-line px-4 text-xs text-ink-dim outline-none transition hover:border-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
        >
          Reset to default layout
        </button>
      </div>
    </div>
  );
}

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

      {activeTab === "widgets" && (
        <div id="kiosk-tabpanel-widgets" role="tabpanel" aria-labelledby="kiosk-tab-widgets">
          <WidgetsTab />
        </div>
      )}
    </section>
  );
}
