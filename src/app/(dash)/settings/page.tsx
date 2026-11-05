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
  const [dashError, setDashError] = useState<{ widgets: string | null; tiles: string | null }>({ widgets: null, tiles: null });

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

  // K12: each save PUTs only its own fields; the route keeps the rest. A widget save never touches the tile draft.
  async function persist(body: Pick<AppConfig, "widgets"> | Pick<AppConfig, "groups" | "urls" | "icons" | "hidden">) {
    await putJson("/api/settings", body);
    await mutate();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  const why = (e: unknown) => (e instanceof Error && e.message ? e.message.replace(/\.$/, "") : "no reason given");

  async function saveWidget(w: WidgetInstance): Promise<boolean> {
    if (!data) return false;
    const widgets = data.config.widgets.some((x) => x.id === w.id)
      ? data.config.widgets.map((x) => (x.id === w.id ? w : x))
      : [...data.config.widgets, w];
    setDashError((d) => ({ ...d, widgets: null }));
    try {
      await persist({ widgets });
      return true;
    } catch (e) {
      setDashError((d) => ({ ...d, widgets: `Couldn’t save the widget: ${why(e)}.` }));
      return false;
    }
  }

  async function deleteWidget(id: string) {
    if (!data) throw new Error("settings not loaded");
    setDashError((d) => ({ ...d, widgets: null }));
    try {
      await persist({ widgets: data.config.widgets.filter((w) => w.id !== id) });
    } catch (e) {
      setDashError((d) => ({ ...d, widgets: `Couldn’t delete the widget: ${why(e)}.` }));
      throw e;
    }
  }

  async function saveTiles() {
    if (!tileDraft) return;
    setSavingTiles(true);
    setDashError((d) => ({ ...d, tiles: null }));
    try {
      await persist({ groups: tileDraft.groups, urls: tileDraft.urls, icons: tileDraft.icons, hidden: tileDraft.hidden });
    } catch (e) {
      setDashError((d) => ({ ...d, tiles: `Couldn’t save tiles: ${why(e)}.` }));
    } finally {
      setSavingTiles(false);
    }
  }
  const tilesDirty =
    !!data && !!tileDraft &&
    JSON.stringify([tileDraft.groups, tileDraft.urls, tileDraft.icons, tileDraft.hidden]) !==
      JSON.stringify([data.config.groups, data.config.urls, data.config.icons, data.config.hidden]);

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
          error={dashError.widgets}
        />
        {tileDraft && (
          <SettingsTiles cfg={tileDraft} containerNames={containerNames} onChange={setTileDraft} onSave={saveTiles} saving={savingTiles} dirty={tilesDirty} error={dashError.tiles} />
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
