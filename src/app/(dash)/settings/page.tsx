"use client";

/* THESIS: Settings accreted section by section (auth, then integrations,
   then hermes, then widgets/tiles) with each addition copying whatever
   idiom was nearest rather than a shared one. This pass ranks that into five
   deliberate sections — Access, Integrations, Hermes, Dashboard, Reference —
   ordered by what the single owner actually reaches for: the gate first,
   then the services this app calls, then the model that drives hermes, then
   the bulk container-tuning work, then read-only reference material last.
   A sticky quick-jump rail (settings-section-nav.tsx) makes that order
   navigable instead of just scrollable. Every panel now shares one grammar —
   Card title + note + status badge, SecretField's write-only masked
   treatment, the same Save placement — via settings-access.tsx,
   settings-integrations.tsx, settings-hermes.tsx, settings-widgets.tsx,
   settings-tiles.tsx and settings-reference.tsx. This file only owns the
   config draft, the PUT, and section order. */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { putJson, useContainers } from "@/lib/client";
import type { AppConfig, WidgetInstance } from "@/lib/config";
import { SettingsIntegrations, useSettingsFull } from "@/components/settings-integrations";
import { SettingsHermes } from "@/components/settings-hermes";
import { SettingsAccess } from "@/components/settings-access";
import { SettingsWidgets } from "@/components/settings-widgets";
import { SettingsTiles } from "@/components/settings-tiles";
import { SettingsReference } from "@/components/settings-reference";
import { SettingsSectionNav, type SettingsSection } from "@/components/settings-section-nav";

const SECTIONS: SettingsSection[] = [
  { id: "access", label: "Access" },
  { id: "integrations", label: "Integrations" },
  { id: "hermes", label: "Hermes" },
  { id: "dashboard", label: "Dashboard" },
  { id: "reference", label: "Reference" },
];

export default function SettingsPage() {
  const { data, mutate } = useSettingsFull();
  const { data: containersData } = useContainers(30000);
  const [tileDraft, setTileDraft] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [savingTiles, setSavingTiles] = useState(false);

  useEffect(() => {
    if (data && !tileDraft) setTileDraft(data.config);
  }, [data, tileDraft]);

  const containerNames = (containersData?.containers ?? []).map((c) => c.name).sort();

  async function persist(config: AppConfig) {
    await putJson("/api/settings", config);
    await mutate();
    setTileDraft(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveWidget(w: WidgetInstance) {
    if (!data) return;
    const widgets = data.config.widgets.some((x) => x.id === w.id)
      ? data.config.widgets.map((x) => (x.id === w.id ? w : x))
      : [...data.config.widgets, w];
    await persist({ ...data.config, widgets });
  }

  async function deleteWidget(id: string) {
    if (!data) return;
    await persist({ ...data.config, widgets: data.config.widgets.filter((w) => w.id !== id) });
  }

  async function saveTiles() {
    if (!tileDraft) return;
    setSavingTiles(true);
    try {
      await persist(tileDraft);
    } finally {
      setSavingTiles(false);
    }
  }

  const cfg = tileDraft;

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            Stored in <span className="font-mono">{data?.meta.dataDir}/config.json</span> — survives restarts, never in git.
          </p>
        </div>
        {saved && <Badge variant="ok">saved</Badge>}
      </header>

      <SettingsSectionNav sections={SECTIONS} />

      <div id="access" className="scroll-mt-20">
        <SettingsAccess />
      </div>

      <div id="integrations" className="scroll-mt-20">
        <SettingsIntegrations />
      </div>

      <div id="hermes" className="scroll-mt-20">
        <SettingsHermes />
      </div>

      <div id="dashboard" className="scroll-mt-20 space-y-5">
        <div>
          <h2 className="microlabel !text-accent">Dashboard</h2>
          <p className="text-[0.7rem] text-ink-dim mt-0.5">
            How containers present on the Overview — widgets pull live stats, tiles control grouping,
            links and visibility.
          </p>
        </div>
        <SettingsWidgets
          widgets={data?.config.widgets ?? []}
          types={data?.meta.widgetTypes ?? ["generic"]}
          containerNames={containerNames}
          onSave={saveWidget}
          onDelete={deleteWidget}
        />
        {cfg && (
          <SettingsTiles
            cfg={cfg}
            containerNames={containerNames}
            onChange={setTileDraft}
            onSave={saveTiles}
            saving={savingTiles}
          />
        )}
      </div>

      <div id="reference" className="scroll-mt-20">
        <SettingsReference />
      </div>
    </div>
  );
}
