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
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
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
  onSave: (w: WidgetInstance) => void;
  onCancel: () => void;
}) {
  const [w, setW] = useState<WidgetInstance>(widget);
  const set = (patch: Partial<WidgetInstance>) => setW({ ...w, ...patch });
  const generic = w.type === "generic";

  return (
    <div className="panel p-4 space-y-3 border-accent/30">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Container</Label>
          <Select value={w.container} onChange={(e) => set({ container: e.target.value })}>
            <option value="">— pick —</option>
            {containers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Type</Label>
          <Select value={w.type} onChange={(e) => set({ type: e.target.value })}>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Service URL</Label>
          <Input placeholder="http://192.168.1.70:8989" value={w.url} onChange={(e) => set({ url: e.target.value })} />
        </div>
        <div>
          <Label>API key</Label>
          <Input type="password" value={w.key ?? ""} onChange={(e) => set({ key: e.target.value || undefined })} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label>Username</Label>
            <Input value={w.username ?? ""} onChange={(e) => set({ username: e.target.value || undefined })} />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={w.password ?? ""} onChange={(e) => set({ password: e.target.value || undefined })} />
          </div>
        </div>
        {generic && (
          <>
            <div className="col-span-2">
              <Label>Endpoint (appended to URL, or absolute)</Label>
              <Input placeholder="/api/stats" value={w.endpoint ?? ""} onChange={(e) => set({ endpoint: e.target.value || undefined })} />
            </div>
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <Label className="!mb-0">Fields (label + JSON dot-path)</Label>
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
                  <Button size="icon" variant="ghost" onClick={() => set({ fields: w.fields!.filter((_, j) => j !== i) })}>
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
}: {
  widgets: WidgetInstance[];
  types: string[];
  containerNames: string[];
  onSave: (w: WidgetInstance) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<WidgetInstance | null>(null);

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
          onSave={(w) => {
            onSave(w);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="panel divide-y divide-line/50">
        {widgets.map((w) => (
          <div key={w.id} className="flex items-center gap-3 px-4 py-2.5">
            <Badge variant="accent">{w.type}</Badge>
            <span className="text-sm font-medium">{w.container}</span>
            <span className="font-mono text-xs text-ink-faint flex-1 truncate">{w.url}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>edit</Button>
            <Button size="icon" variant="ghost" onClick={() => onDelete(w.id)}>
              <Trash2 size={13} />
            </Button>
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
