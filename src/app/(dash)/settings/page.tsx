"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import {
  putJson,
  useContainers,
  useSettings,
  type AppConfig,
} from "@/lib/client";
import type { WidgetInstance } from "@/lib/config";

// ---------------------------------------------------------------------------

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
      <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-2">
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
                <div key={i} className="flex gap-2 mb-1.5">
                  <Input placeholder="Queries" value={f.label}
                    onChange={(e) => set({ fields: w.fields!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Input placeholder="queries.total" value={f.path}
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

export default function SettingsPage() {
  const { data, mutate } = useSettings();
  const { data: containersData } = useContainers(30000);
  const [editing, setEditing] = useState<WidgetInstance | null>(null);
  const [tileDraft, setTileDraft] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState(false);

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
    setEditing(null);
  }

  async function deleteWidget(id: string) {
    if (!data) return;
    await persist({ ...data.config, widgets: data.config.widgets.filter((w) => w.id !== id) });
  }

  const cfg = tileDraft;

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            Stored in <span className="font-mono">{data?.meta.dataDir}/config.json</span> — survives restarts, never in git.
          </p>
        </div>
        {saved && <Badge variant="ok">saved</Badge>}
      </header>

      {/* auth status */}
      <Card>
        <CardHeader>
          <CardTitle>Auth</CardTitle>
          {data?.meta.authConfigured ? (
            <Badge variant="ok">password set</Badge>
          ) : (
            <Badge variant="bad">NO PASSWORD — login disabled outside dev</Badge>
          )}
        </CardHeader>
        <CardContent className="text-xs text-ink-dim space-y-1">
          <p>
            Login uses <span className="font-mono">ADMIN_PASSWORD_HASH</span> (bcrypt) from the environment.
            Generate one with <span className="font-mono text-accent">npm run hash-password -- &apos;pass&apos;</span> and set it in the compose file.
          </p>
          <p>The dashboard should also sit behind an NPM access list — two layers, always.</p>
        </CardContent>
      </Card>

      {/* widgets */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="microlabel !text-accent">Service widgets</h2>
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
            types={data?.meta.widgetTypes ?? ["generic"]}
            containers={containerNames}
            onSave={saveWidget}
            onCancel={() => setEditing(null)}
          />
        )}

        <div className="panel divide-y divide-line/50">
          {(data?.config.widgets ?? []).map((w) => (
            <div key={w.id} className="flex items-center gap-3 px-4 py-2.5">
              <Badge variant="accent">{w.type}</Badge>
              <span className="text-sm font-medium">{w.container}</span>
              <span className="font-mono text-xs text-ink-faint flex-1 truncate">{w.url}</span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>edit</Button>
              <Button size="icon" variant="ghost" onClick={() => deleteWidget(w.id)}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          {!data?.config.widgets.length && (
            <div className="px-4 py-6 text-center text-xs text-ink-faint">
              No widgets configured yet. Containers with <span className="font-mono">dashboard.widget.*</span> labels appear automatically.
            </div>
          )}
        </div>
      </section>

      {/* tiles */}
      {cfg && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="microlabel !text-accent">Tiles — groups, URLs, icons, visibility</h2>
            <Button size="sm" onClick={() => persist(cfg)}>
              <Save size={13} /> Save tiles
            </Button>
          </div>
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {["Container", "Group", "App URL", "Icon (slug or URL)", "Hide"].map((h) => (
                    <th key={h} className="microlabel text-left px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {containerNames.map((name) => {
                  const groupOf = cfg.groups.find((g) => g.containers.includes(name))?.name ?? "";
                  return (
                    <tr key={name} className="border-b border-line/50 last:border-0">
                      <td className="px-3 py-1.5 font-mono text-xs">{name}</td>
                      <td className="px-3 py-1.5">
                        <Input
                          className="h-7"
                          placeholder="(compose project)"
                          value={groupOf}
                          onChange={(e) => {
                            const groups = cfg.groups
                              .map((g) => ({ ...g, containers: g.containers.filter((c) => c !== name) }))
                              .filter((g) => g.containers.length > 0 || g.name === e.target.value);
                            const target = e.target.value.trim();
                            if (target) {
                              const existing = groups.find((g) => g.name === target);
                              if (existing) existing.containers.push(name);
                              else groups.push({ name: target, containers: [name] });
                            }
                            setTileDraft({ ...cfg, groups });
                          }}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          className="h-7"
                          placeholder="(inferred)"
                          value={cfg.urls[name] ?? ""}
                          onChange={(e) => {
                            const urls = { ...cfg.urls };
                            if (e.target.value) urls[name] = e.target.value;
                            else delete urls[name];
                            setTileDraft({ ...cfg, urls });
                          }}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          className="h-7"
                          placeholder="(auto)"
                          value={cfg.icons[name] ?? ""}
                          onChange={(e) => {
                            const icons = { ...cfg.icons };
                            if (e.target.value) icons[name] = e.target.value;
                            else delete icons[name];
                            setTileDraft({ ...cfg, icons });
                          }}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={cfg.hidden.includes(name)}
                          onChange={(e) =>
                            setTileDraft({
                              ...cfg,
                              hidden: e.target.checked
                                ? [...cfg.hidden, name]
                                : cfg.hidden.filter((h) => h !== name),
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* references */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Label convention</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-[0.7rem] text-ink-dim space-y-1">
            <div>dashboard.enable=false <span className="text-ink-faint"># hide tile</span></div>
            <div>dashboard.url=http://…</div>
            <div>dashboard.icon=jellyfin <span className="text-ink-faint"># selfh.st slug or URL</span></div>
            <div>dashboard.group=Media</div>
            <div>dashboard.widget.type=generic</div>
            <div>dashboard.widget.endpoint=http://…/api/stats</div>
            <div>dashboard.widget.path=Queries:queries.total,Hits:cache.hits</div>
            <div>dashboard.widget.key=&lt;api key&gt;</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Socket-proxy scopes (reference)</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-[0.7rem] text-ink-dim space-y-1">
            <div className="text-accent"># read</div>
            <div>CONTAINERS=1 IMAGES=1 INFO=1</div>
            <div>NETWORKS=1 VOLUMES=1 PING=1</div>
            <div className="text-accent"># write (start/stop/restart/create)</div>
            <div>POST=1 ALLOW_START=1 ALLOW_STOP=1 ALLOW_RESTARTS=1</div>
            <div className="text-bad"># never: EXEC=1</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
