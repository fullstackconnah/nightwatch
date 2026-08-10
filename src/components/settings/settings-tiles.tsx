"use client";

/* THESIS: the audit's headline finding — this table rendered every container
   on the box (~30 rows, desktop table AND mobile card list) with three empty
   inputs each by default, a wall-of-forms almost the whole page was scrolling
   through. Fix is a lens, not less data: a Customized/All segmented toggle
   (the one control DESIGN.md reserves for "switching a lens on the same
   subject") defaulting to Customized, plus a name filter — same idiom as the
   OpenRouter model filter in settings-hermes.tsx and the Containers page
   search. Editing semantics (group/url/icon/hidden merge logic) are moved
   here verbatim from the old page.tsx, just factored into named helpers; the
   parent still owns the draft object and the PUT, this component only reads
   and mutates the slice it's handed. */

import { useMemo, useState } from "react";
import { Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SegmentButton } from "@/components/ui/segment-button";
import type { AppConfig } from "@/lib/config";

function isCustomized(cfg: AppConfig, name: string): boolean {
  return Boolean(
    cfg.urls[name] ||
      cfg.icons[name] ||
      cfg.hidden.includes(name) ||
      cfg.groups.some((g) => g.containers.includes(name)),
  );
}

function groupOf(cfg: AppConfig, name: string): string {
  return cfg.groups.find((g) => g.containers.includes(name))?.name ?? "";
}

function withGroup(cfg: AppConfig, name: string, value: string): AppConfig {
  const groups = cfg.groups
    .map((g) => ({ ...g, containers: g.containers.filter((c) => c !== name) }))
    .filter((g) => g.containers.length > 0 || g.name === value);
  const target = value.trim();
  if (target) {
    const existing = groups.find((g) => g.name === target);
    if (existing) existing.containers.push(name);
    else groups.push({ name: target, containers: [name] });
  }
  return { ...cfg, groups };
}

function withUrl(cfg: AppConfig, name: string, value: string): AppConfig {
  const urls = { ...cfg.urls };
  if (value) urls[name] = value;
  else delete urls[name];
  return { ...cfg, urls };
}

function withIcon(cfg: AppConfig, name: string, value: string): AppConfig {
  const icons = { ...cfg.icons };
  if (value) icons[name] = value;
  else delete icons[name];
  return { ...cfg, icons };
}

function withHidden(cfg: AppConfig, name: string, hide: boolean): AppConfig {
  return { ...cfg, hidden: hide ? [...cfg.hidden, name] : cfg.hidden.filter((h) => h !== name) };
}

export function SettingsTiles({
  cfg,
  containerNames,
  onChange,
  onSave,
  saving,
}: {
  cfg: AppConfig;
  containerNames: string[];
  onChange: (cfg: AppConfig) => void;
  onSave: () => void;
  saving?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"customized" | "all">("customized");

  const customizedCount = useMemo(
    () => containerNames.filter((n) => isCustomized(cfg, n)).length,
    [cfg, containerNames],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return containerNames.filter((n) => {
      if (scope === "customized" && !isCustomized(cfg, n)) return false;
      if (q && !n.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [containerNames, cfg, query, scope]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="microlabel">Tiles</h3>
          <p className="text-[0.7rem] text-ink-dim mt-0.5">
            Group, URL, icon and visibility overrides — {customizedCount} of {containerNames.length} containers customized.
          </p>
        </div>
        <Button size="sm" onClick={onSave} disabled={saving}>
          <Save size={13} /> Save tiles
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="panel p-1 flex gap-1 w-fit" role="group" aria-label="Container scope">
          <SegmentButton
            active={scope === "customized"}
            label={`Customized — ${customizedCount} of ${containerNames.length}`}
            onClick={() => setScope("customized")}
          >
            Customized ({customizedCount})
          </SegmentButton>
          <SegmentButton
            active={scope === "all"}
            label={`All ${containerNames.length} containers`}
            onClick={() => setScope("all")}
          >
            All ({containerNames.length})
          </SegmentButton>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <Input
            placeholder="filter by name…"
            aria-label="Filter containers by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 pr-8"
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
      </div>

      {rows.length === 0 && (
        <div className="panel px-4 py-6 text-center text-xs text-ink-faint">
          {query
            ? `No container matches "${query}".`
            : "No customized containers yet — every tile is using its inferred group, URL and icon. Switch to All to add one."}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="panel overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {["Container", "Group", "App URL", "Icon (slug or URL)", "Hide"].map((h) => (
                    <th key={h} className="microlabel text-left px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((name) => (
                  <tr key={name} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs">{name}</td>
                    {/* aria-label per control, naming the column AND the row:
                        a visible label in each cell would wreck a table whose
                        whole point is the column header, but a screen-reader
                        user tabbing through 35 rows of identical-looking
                        fields otherwise hears "edit text" 105 times with no
                        idea which container or which column they are in.
                        Header-cell association alone doesn't carry reliably
                        for form controls inside cells. */}
                    <td className="px-3 py-1.5">
                      <Input
                        className="h-7"
                        aria-label={`Group for ${name}`}
                        placeholder="(compose project)"
                        value={groupOf(cfg, name)}
                        onChange={(e) => onChange(withGroup(cfg, name, e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        className="h-7"
                        aria-label={`App URL for ${name}`}
                        placeholder="(inferred)"
                        value={cfg.urls[name] ?? ""}
                        onChange={(e) => onChange(withUrl(cfg, name, e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        className="h-7"
                        aria-label={`Icon for ${name}`}
                        placeholder="(auto)"
                        value={cfg.icons[name] ?? ""}
                        onChange={(e) => onChange(withIcon(cfg, name, e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Hide ${name}`}
                        checked={cfg.hidden.includes(name)}
                        onChange={(e) => onChange(withHidden(cfg, name, e.target.checked))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2">
            {rows.map((name) => (
              <div key={name} className="panel p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm truncate">{name}</span>
                  <label className="flex items-center gap-2 min-h-11 pl-2 cursor-pointer text-xs text-ink-dim">
                    hide
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={cfg.hidden.includes(name)}
                      onChange={(e) => onChange(withHidden(cfg, name, e.target.checked))}
                    />
                  </label>
                </div>
                {/* Field, not a bare Label beside an Input: Field wires
                    htmlFor/id through useId, so these actually name their
                    control. The desktop table above can't use it (a label per
                    cell would fight the column header), which is why that half
                    carries aria-label instead. */}
                <Field label="Group">
                  <Input
                    placeholder="(compose project)"
                    value={groupOf(cfg, name)}
                    onChange={(e) => onChange(withGroup(cfg, name, e.target.value))}
                  />
                </Field>
                <Field label="App URL">
                  <Input
                    placeholder="(inferred)"
                    value={cfg.urls[name] ?? ""}
                    onChange={(e) => onChange(withUrl(cfg, name, e.target.value))}
                  />
                </Field>
                <Field label="Icon">
                  <Input
                    placeholder="(auto)"
                    value={cfg.icons[name] ?? ""}
                    onChange={(e) => onChange(withIcon(cfg, name, e.target.value))}
                  />
                </Field>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
