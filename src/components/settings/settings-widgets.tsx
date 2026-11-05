"use client";

/* THESIS: extracted verbatim from the old settings page.tsx — the widget
   editor's field logic (generic-only endpoint/fields block) and the widget
   list are unchanged, only relocated and re-headed one level under the new
   "Dashboard" mega-section (h3 microlabel instead of the old top-level h2
   !text-accent). save/delete stay owned by the parent page so the
   read-modify-write PUT contract in src/app/api/settings/route.ts never
   sees two components racing each other's drafts. */

import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WriteAction } from "@/components/strips/write-action";
import { useFormReport } from "@/components/settings/form-report";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ClearAction, SecretField } from "@/components/settings/settings-integrations";
import type { WidgetInstance } from "@/lib/config";

function WidgetEditor({
  widget,
  types,
  containers,
  onSave,
  onCancel,
}: {
  widget: WidgetInstance;
  types: string[];
  containers: string[];
  onSave: (w: WidgetInstance) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [w, setW] = useState<WidgetInstance>(widget);
  const set = (patch: Partial<WidgetInstance>) => setW({ ...w, ...patch });
  const generic = w.type === "generic";
  // Secrets are write-only: the server sends keySet/passwordSet, an empty draft keeps the stored value, Clear removes it.
  const secret = (f: "key" | "password", label: string, flag: boolean | undefined, clear: "clearKey" | "clearPassword") => (
    <div>
      <SecretField label={label} configured={Boolean(flag)} draft={w[f] ?? ""} onDraftChange={(v) => set({ [f]: v || undefined })} />
      {flag && (
        <div className="mt-1">
          <ClearAction
            say={`Removes the saved ${label.toLowerCase()} from this widget. It stops working until you enter one again.`}
            failure={`Couldn’t clear the ${label.toLowerCase()}`}
            run={async () => {
              if (!(await onSave({ ...w, [f]: undefined, [clear]: true }))) throw new Error("the widget wasn’t saved");
            }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="panel p-4 space-y-3 border-accent/30">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Container" required>
          <Select value={w.container} onChange={(e) => set({ container: e.target.value })}>
            <option value="">— pick —</option>
            {containers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={w.type} onChange={(e) => set({ type: e.target.value })}>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Service URL" required className="col-span-2">
          <Input placeholder="http://homelab.local:8989" value={w.url} onChange={(e) => set({ url: e.target.value })} />
        </Field>
        {secret("key", "API key", w.keySet, "clearKey")}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Username">
            <Input value={w.username ?? ""} onChange={(e) => set({ username: e.target.value || undefined })} />
          </Field>
          {secret("password", "Password", w.passwordSet, "clearPassword")}
        </div>
        {generic && (
          <>
            <Field label="Endpoint (appended to URL, or absolute)" className="col-span-2">
              <Input placeholder="/api/stats" value={w.endpoint ?? ""} onChange={(e) => set({ endpoint: e.target.value || undefined })} />
            </Field>
            {/* A <label> element would be lying here: this captions a repeating
                group of field rows, not one control, so there is nothing for it
                to be `for`. It's a group caption wired by aria-labelledby —
                same treatment settings-hermes.tsx gives its Tier/Model rows. */}
            <div className="col-span-2" role="group" aria-labelledby="widget-fields-label">
              <div className="flex items-center justify-between mb-1.5">
                <span id="widget-fields-label" className="microlabel">
                  Fields (label + JSON dot-path)
                </span>
                <Button size="sm" variant="ghost"
                  onClick={() => set({ fields: [...(w.fields ?? []), { label: "", path: "", format: "text" }] })}>
                  <Plus size={12} /> field
                </Button>
              </div>
              {(w.fields ?? []).map((f, i) => (
                <div key={i} className="flex flex-wrap gap-2 mb-1.5">
                  <Input placeholder="Queries" value={f.label} className="min-w-0 flex-1 basis-[10rem]"
                    onChange={(e) => set({ fields: w.fields!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Input placeholder="queries.total" value={f.path} className="min-w-0 flex-1 basis-[10rem]"
                    onChange={(e) => set({ fields: w.fields!.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)) })} />
                  <Select className="w-28" value={f.format ?? "text"}
                    onChange={(e) => set({ fields: w.fields!.map((x, j) => (j === i ? { ...x, format: e.target.value as never } : x)) })}>
                    {["text", "number", "bytes", "rate", "percent"].map((fm) => (
                      <option key={fm}>{fm}</option>
                    ))}
                  </Select>
                  <Button size="icon" variant="ghost" aria-label={`Remove field ${f.label || f.path}`} onClick={() => set({ fields: w.fields!.filter((_, j) => j !== i) })}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={!w.container || !w.url} onClick={() => onSave(w)}>
          <Save size={13} /> Save widget
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SettingsWidgets({
  widgets,
  types,
  containerNames,
  onSave,
  onDelete,
  error,
}: {
  widgets: WidgetInstance[];
  types: string[];
  containerNames: string[];
  /** Resolves true when the PUT landed; the editor closes only then, so a failed save keeps the draft (K4). */
  onSave: (w: WidgetInstance) => Promise<boolean>;
  /** Throws on failure; the delete frame shows the reason. */
  onDelete: (id: string) => Promise<void>;
  /** The last save failure, from the page ("Couldn't save the widget: ..."). */
  error: string | null;
}) {
  const [editing, setEditing] = useState<WidgetInstance | null>(null);
  const [deleting, setDeleting] = useState(false);
  useFormReport("widgets", { dirty: editing !== null, error });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="microlabel">Service widgets</h3>
          <p className="text-[0.7rem] text-ink-dim mt-0.5">
            Live stats pulled from a container&apos;s own API onto its Overview tile.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            setEditing({
              id: `w_${Math.random().toString(36).slice(2, 9)}`,
              container: "",
              type: "generic",
              url: "",
            })
          }
        >
          <Plus size={13} /> Add widget
        </Button>
      </div>

      {editing && (
        <WidgetEditor
          widget={editing}
          types={types}
          containers={containerNames}
          onSave={async (w) => {
            const ok = await onSave(w);
            if (ok) setEditing(null);
            return ok;
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {error && !deleting && <p className="text-[0.7rem] text-bad">{error}</p>}

      <div className="panel divide-y divide-line/50">
        {widgets.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <Badge variant="accent">{w.type}</Badge>
            <span className="text-sm font-medium min-w-0 truncate">{w.container}</span>
            <span className="font-mono text-xs text-ink-faint flex-1 min-w-0 truncate">{w.url}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>edit</Button>
            <WriteAction
              label=""
              ariaLabel={`Delete ${w.container} widget`}
              icon={<Trash2 size={13} />}
              say={`Deletes the ${w.container} widget. Add it again to bring it back.`}
              yes="Yes, delete"
              danger
              triggerClassName="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
              flight="Deleting…"
              failure="Couldn’t delete the widget"
              run={() => onDelete(w.id)}
              onActive={setDeleting}
            />
          </div>
        ))}
        {!widgets.length && (
          <div className="px-4 py-6 text-center text-xs text-ink-faint">
            No widgets configured yet. Containers with <span className="font-mono">dashboard.widget.*</span> labels appear automatically.
          </div>
        )}
      </div>
    </div>
  );
}
