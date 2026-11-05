"use client";

/* Settings on the strips pattern: the head says whether anything needs you, nine strips each hold one area's forms
   (Access, six integrations, Hermes, Dashboard). The page owns the tile draft and the widget/tile writes (3b gives
   those the strip treatment); every other form reports its draft and last error up through useFormReport. */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PageHead } from "@/components/strips/page-head";
import { StripList, type StripSpec } from "@/components/strips/strip-list";
import { putJson, useContainers } from "@/lib/client";
import type { AppConfig, WidgetInstance } from "@/lib/config";
import { legacyStripHash, settingsModel, type FormId, type FormState, type StripId } from "@/lib/settings/page-model";
import { useNow } from "@/lib/use-now";
import { FormReportProvider } from "@/components/settings/form-report";
import { AccessBody } from "@/components/settings/settings-access";
import { SettingsHermes, SettingsHermesDaemon } from "@/components/settings/settings-hermes";
import {
  ForgejoPanel,
  GithubPanel,
  HomeAssistantPanel,
  MinecraftPanel,
  NpmPanel,
  VoiceCard,
  useSettingsFull,
} from "@/components/settings/settings-integrations";
import { LabelConventionPanel } from "@/components/settings/settings-reference";
import { SettingsTiles, isCustomized } from "@/components/settings/settings-tiles";
import { SettingsWidgets } from "@/components/settings/settings-widgets";

export default function SettingsPage() {
  const { data, error, mutate } = useSettingsFull((at) => setLoadedAt(at));
  const { data: containersData } = useContainers(30000);
  const now = useNow(true);
  const [tileDraft, setTileDraft] = useState<AppConfig | null>(null);
  const [savingTiles, setSavingTiles] = useState(false);
  const [forms, setForms] = useState<Partial<Record<FormId, FormState>>>({});
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const report = useCallback((id: FormId, s: FormState) => {
    setForms((f) => (f[id]?.dirty === s.dirty && f[id]?.error === s.error ? f : { ...f, [id]: s }));
  }, []);

  useEffect(() => {
    if (data && !tileDraft) setTileDraft(data.config);
  }, [data, tileDraft]);
  useEffect(() => {
    const h = legacyStripHash(window.location.hash);
    if (h !== window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search + h);
  }, []);

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

  const tiles =
    data && containersData
      ? { customized: containerNames.filter((n) => isCustomized(data.config, n)).length, total: containerNames.length }
      : null;
  const model = settingsModel({ data, loadError: error ? error.message : null, loadedAt, forms, tiles, now });

  const lead = (id: StripId, body: React.ReactNode) => (
    <>
      {model.autoTarget === id && model.detailLead && <p className="st-note">{model.detailLead}</p>}
      {body}
    </>
  );
  const panel = { data, mutate };
  const bodies: Record<StripId, React.ReactNode> = {
    access: <AccessBody {...panel} />,
    homeassistant: <HomeAssistantPanel {...panel} />,
    npm: <NpmPanel {...panel} />,
    forgejo: <ForgejoPanel {...panel} />,
    github: <GithubPanel {...panel} />,
    minecraft: <MinecraftPanel {...panel} />,
    voice: <VoiceCard {...panel} />,
    hermes: (
      <div className="space-y-5">
        <SettingsHermes />
        <SettingsHermesDaemon />
      </div>
    ),
    dashboard: (
      <div className="relative space-y-5">
        <Badge variant="ok" className="nw-fade absolute -top-8 right-0" data-on={saved ? "" : undefined}>saved</Badge>
        <SettingsWidgets
          widgets={data?.config.widgets ?? []}
          types={data?.meta.widgetTypes ?? ["generic"]}
          containerNames={containerNames}
          onSave={saveWidget}
          onDelete={deleteWidget}
        />
        {tileDraft && (
          <SettingsTiles cfg={tileDraft} containerNames={containerNames} onChange={setTileDraft} onSave={saveTiles} saving={savingTiles} />
        )}
        <LabelConventionPanel />
      </div>
    ),
  };
  const strips: StripSpec[] = model.strips.map((s) => ({ ...s, body: lead(s.id, bodies[s.id]) }));

  return (
    <FormReportProvider value={report}>
      <div className="st-page pb-2">
        <PageHead title="Settings" chip={model.chip} answer={model.answer} evidence={model.evidence} notice={model.notice} />
        {strips.length > 0 && <StripList strips={strips} autoTarget={model.autoTarget} keepMounted />}
      </div>
    </FormReportProvider>
  );
}
