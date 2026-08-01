"use client";

/* THESIS: one panel picks which brain hermes calls next run — a tier switch
   (LOCAL/OPENROUTER/ANTHROPIC), a model picker whose shape depends on the
   tier, and the two hosted-tier API keys under the same write-only masked
   semantics as settings-integrations.tsx's SecretField. Saving writes both
   config.json (this panel's own read model) and a sibling hermes-model.json
   that the hermes daemon hot-reads — see src/app/api/hermes/model/route.ts.
   OWN-WORLD: nightwatch console — segmented control idiom for the tier,
   mono for every model id/price/context figure, honest unreachable copy for
   the two live model-list fetches (ollama, openrouter). */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Save, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentButton } from "@/components/ui/segment-button";
import { fetcher, postJson } from "@/lib/client";
import { formatNumber, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SecretField, useSettingsFull } from "@/components/settings-integrations";

type Tier = "local" | "openrouter" | "anthropic";

const TIERS: { id: Tier; label: string }[] = [
  { id: "local", label: "LOCAL" },
  { id: "openrouter", label: "OPENROUTER" },
  { id: "anthropic", label: "ANTHROPIC" },
];

const ANTHROPIC_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];

interface LocalModelsResponse {
  reachable: boolean;
  detail?: string;
  suggested: string;
  models: string[];
}

/** Mirrors OpenRouterModel from src/app/api/hermes/openrouter-models/route.ts
 *  (kept as a local copy rather than a cross-import from an API route module,
 *  same self-containment as every other settings-*.tsx piece here). */
interface OpenRouterModel {
  id: string;
  name: string;
  promptPrice: number | null;
  completionPrice: number | null;
  contextLength: number | null;
}

interface OpenRouterModelsResponse {
  status: "ok" | "stale" | "error";
  detail?: string;
  cachedAt: string | null;
  models: OpenRouterModel[];
}

function useLocalModels(enabled: boolean) {
  return useSWR<LocalModelsResponse>(enabled ? "/api/hermes/local-models" : null, fetcher);
}

function useOpenRouterModels(enabled: boolean) {
  return useSWR<OpenRouterModelsResponse>(enabled ? "/api/hermes/openrouter-models" : null, fetcher, {
    revalidateOnFocus: false,
  });
}

// ---------------------------------------------------------------------------

function ModelOptionRow({
  id,
  sublabel,
  selected,
  onSelect,
}: {
  id: string;
  sublabel?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full flex items-center justify-between gap-2 px-3 min-h-11 md:min-h-9 md:py-1 rounded-md border text-left transition cursor-pointer",
        selected
          ? "bg-accent/10 border-accent/30 text-accent"
          : "border-line text-ink-dim hover:text-ink hover:bg-panel-2 hover:border-line-bright",
      )}
    >
      <span className="font-mono text-xs truncate">{id}</span>
      {sublabel && <span className="text-[0.7rem] text-ink-faint shrink-0">{sublabel}</span>}
    </button>
  );
}

function ModelPickerSkeleton() {
  return (
    <div className="space-y-1.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-11 md:h-9 rounded-md bg-panel-2 animate-pulse motion-reduce:animate-none"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LocalModelPicker({ model, onSelect }: { model: string; onSelect: (id: string) => void }) {
  const { data, isLoading } = useLocalModels(true);

  return (
    <div className="space-y-1.5">
      <ModelOptionRow
        id="hermes-local"
        sublabel="default → qwen3:8b"
        selected={model === "hermes-local"}
        onSelect={() => onSelect("hermes-local")}
      />
      {isLoading && <ModelPickerSkeleton />}
      {data && data.reachable && (
        data.models.length > 0 ? (
          data.models.map((name) => (
            <ModelOptionRow key={name} id={name} selected={model === name} onSelect={() => onSelect(name)} />
          ))
        ) : (
          <p className="text-[0.7rem] text-ink-faint px-1">ollama is reachable but has no models installed.</p>
        )
      )}
      {data && !data.reachable && (
        <div className="space-y-2 pt-1">
          <p className="text-[0.7rem] text-warn/80">{data.detail}</p>
          <div>
            <Label>Model name (manual)</Label>
            <Input
              value={model === "hermes-local" ? "" : model}
              onChange={(e) => onSelect(e.target.value)}
              placeholder="ollama/llama3:70b"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const VISIBLE_CAP = 40;

function formatPerMillion(pricePerToken: number | null): string {
  if (pricePerToken == null) return "—";
  const perM = pricePerToken * 1_000_000;
  return `$${perM < 1 ? perM.toFixed(3) : perM.toFixed(2)}/M`;
}

function OpenRouterPicker({ model, onSelect }: { model: string; onSelect: (id: string) => void }) {
  const { data, isLoading, error } = useOpenRouterModels(true);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.models;
    return data.models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [data, query]);

  const visible = filtered.slice(0, VISIBLE_CAP);
  const more = filtered.length - visible.length;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter models — id or name"
          aria-label="Filter OpenRouter models"
          className="h-11 md:h-8 w-full rounded-md bg-panel-2 border border-line pl-8 pr-8 font-mono text-xs placeholder:text-ink-faint focus:outline-none focus:border-accent/50 transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear filter"
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-11 w-11 md:h-6 md:w-6 text-ink-faint hover:text-ink cursor-pointer"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {isLoading && <ModelPickerSkeleton />}

      {error && (
        <p className="text-[0.7rem] text-bad px-1">Could not load the OpenRouter catalogue — {error.message}</p>
      )}

      {data && data.status === "error" && (
        <p className="text-[0.7rem] text-bad px-1">{data.detail ?? "openrouter unreachable"}</p>
      )}

      {data && data.status === "stale" && (
        <p className="text-[0.7rem] text-warn/80 px-1">
          openrouter unreachable — showing the cached catalogue from{" "}
          {data.cachedAt ? relativeTime(data.cachedAt) : "earlier"}.
        </p>
      )}

      {data && data.models.length > 0 && (
        <>
          {filtered.length === 0 ? (
            <p className="text-[0.7rem] text-ink-faint px-1">no models match &quot;{query}&quot;.</p>
          ) : (
            <div className="panel divide-y divide-line/50 max-h-72 overflow-y-auto">
              {visible.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelect(m.id)}
                  aria-pressed={model === m.id}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-3 py-2 min-h-11 md:min-h-0 md:py-1.5 text-left cursor-pointer transition",
                    model === m.id ? "bg-accent/10 text-accent" : "hover:bg-panel-2 text-ink-dim",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs truncate">{m.id}</span>
                    <span className="block text-[0.7rem] text-ink-faint truncate">{m.name}</span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-[0.65rem] text-ink-faint leading-tight">
                    <span className="block">{formatPerMillion(m.promptPrice)} in</span>
                    <span className="block">{formatPerMillion(m.completionPrice)} out</span>
                    {m.contextLength != null && <span className="block">{formatNumber(m.contextLength)} ctx</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {more > 0 && (
            <p className="text-[0.7rem] text-ink-faint px-1">{more} more — refine filter</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function HermesSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-3 w-2/3 rounded bg-panel-2 animate-pulse motion-reduce:animate-none" />
      <div className="h-10 w-48 rounded bg-panel-2 animate-pulse motion-reduce:animate-none" />
      <ModelPickerSkeleton />
    </div>
  );
}

export function SettingsHermes() {
  const { data, mutate } = useSettingsFull();
  const [tier, setTier] = useState<Tier>("local");
  const [model, setModel] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Bumped on every successful save and used as the two SecretFields' `key` —
  // forces a remount so replacing an already-configured key collapses back to
  // the masked view too (see the identical pattern/comment in
  // settings-integrations.tsx's UrlTokenPanel).
  const [saveVersion, setSaveVersion] = useState(0);

  useEffect(() => {
    if (data && !seeded) {
      setTier(data.config.hermes?.tier ?? "local");
      setModel(data.config.hermes?.model ?? "");
      setSeeded(true);
    }
  }, [data, seeded]);

  const hermesStatus = data?.integrations.hermes;
  const lastSaved = data?.meta.hermesModelUpdatedAt ?? null;

  const needsOpenrouterKey = tier === "openrouter" && !hermesStatus?.openrouterConfigured && !openrouterKey.trim();
  const needsAnthropicKey = tier === "anthropic" && !hermesStatus?.anthropicConfigured && !anthropicKey.trim();

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/hermes/model", {
        tier,
        model,
        openrouterApiKey: openrouterKey || undefined,
        anthropicApiKey: anthropicKey || undefined,
      });
      await mutate();
      setOpenrouterKey("");
      setAnthropicKey("");
      setSaveVersion((v) => v + 1);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="microlabel !text-accent">Hermes · model</h2>
        {saved && <Badge variant="ok">saved</Badge>}
      </div>
      <div className="panel p-4 space-y-4">
        {!data && <HermesSkeleton />}
        {data && (
          <>
            <p className="text-[0.7rem] text-ink-dim">
              Changes apply on hermes&apos;s next scheduled run — no restart needed.
              {lastSaved && <> Model file last written {relativeTime(lastSaved)}.</>}
            </p>

            <div>
              <Label>Tier</Label>
              <div className="panel p-1 flex gap-1 w-fit" role="group" aria-label="Hermes model tier">
                {TIERS.map((t) => (
                  <SegmentButton key={t.id} active={tier === t.id} label={t.label} onClick={() => setTier(t.id)}>
                    {t.label}
                  </SegmentButton>
                ))}
              </div>
            </div>

            <div>
              <Label>Model</Label>
              {tier === "local" && <LocalModelPicker model={model} onSelect={setModel} />}
              {tier === "openrouter" && <OpenRouterPicker model={model} onSelect={setModel} />}
              {tier === "anthropic" && (
                <div className="space-y-1.5">
                  {ANTHROPIC_MODELS.map((id) => (
                    <ModelOptionRow key={id} id={id} selected={model === id} onSelect={() => setModel(id)} />
                  ))}
                </div>
              )}
              {model && (
                <p className="mt-1.5 text-[0.7rem] text-ink-faint">
                  selected: <span className="font-mono text-ink-dim">{model}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <SecretField
                  key={saveVersion}
                  label="OpenRouter API key"
                  configured={hermesStatus?.openrouterConfigured ?? false}
                  updatedAt={hermesStatus?.openrouterConfigured ? (lastSaved ?? undefined) : undefined}
                  draft={openrouterKey}
                  onDraftChange={setOpenrouterKey}
                  placeholder="sk-or-..."
                />
                <p className="mt-1 text-[0.7rem] text-ink-dim">
                  Mint one at{" "}
                  <a
                    href="https://openrouter.ai/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    openrouter.ai/settings/keys
                  </a>
                  .
                </p>
              </div>
              <div>
                <SecretField
                  key={saveVersion}
                  label="Anthropic API key"
                  configured={hermesStatus?.anthropicConfigured ?? false}
                  updatedAt={hermesStatus?.anthropicConfigured ? (lastSaved ?? undefined) : undefined}
                  draft={anthropicKey}
                  onDraftChange={setAnthropicKey}
                  placeholder="sk-ant-..."
                />
                <p className="mt-1 text-[0.7rem] text-ink-dim">
                  Mint one at{" "}
                  <a
                    href="https://console.anthropic.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    console.anthropic.com
                  </a>
                  .
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
              {error && <span className="text-[0.7rem] text-bad">{error}</span>}
              <Button
                size="sm"
                disabled={saving || !model.trim() || needsOpenrouterKey || needsAnthropicKey}
                onClick={handleSave}
              >
                <Save size={13} /> Save
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
