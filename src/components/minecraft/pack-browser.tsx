/**
 * Search CurseForge + Modrinth for a modpack, install it, and switch the
 * active instance to it — plus the list of what's already installed
 * (activate/delete). One pendingKey/confirmKey pair shared across both
 * sections: only one row can be mid-confirm or mid-request at a time, so a
 * double-click on a second row while the first is still in flight can't fire
 * two lifecycle-altering requests at once.
 *
 * No toasts, no window.confirm — every destructive or server-switching
 * action swaps its trigger button for an inline Cancel/Confirm pair first.
 */
"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ApiError, postJson, useMinecraftPackSearch } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import type { McInstance } from "@/lib/minecraft/manager";
import type { PackResult } from "@/lib/minecraft/packs";

const SOURCE_VARIANT = { curseforge: "accent", modrinth: "blue" } as const;
const compactNumber = new Intl.NumberFormat("en", { notation: "compact" });

/**
 * On a 409 from POST /instances (already installed), the create call never
 * returns the instance's slug — only an error. The manager's slug is a
 * deterministic sanitize of the pack's own slug, so the existing instance in
 * `instances` is found by matching either the raw slug or (source, packRef)
 * rather than re-deriving the manager's sanitize rule client-side.
 */
function findInstalledSlug(pack: PackResult, instances: McInstance[]): string | null {
  const bySlug = instances.find((i) => i.slug === pack.slug);
  if (bySlug) return bySlug.slug;
  const byRef = instances.find((i) => i.source === pack.source && i.packRef === pack.pageUrl);
  return byRef?.slug ?? null;
}

function installCopy(activeName: string | undefined, targetName: string): string {
  return activeName
    ? `Stops "${activeName}" and switches to "${targetName}". First boot can take several minutes.`
    : `Installs "${targetName}". First boot can take several minutes.`;
}

function switchCopy(activeName: string | undefined, targetName: string): string {
  return activeName
    ? `Stops "${activeName}" and switches to "${targetName}". Loading the modpack can take a few minutes.`
    : `Switches to "${targetName}". Loading the modpack can take a few minutes.`;
}

export function PackBrowser({
  instances,
  active,
  onChanged,
}: {
  instances: McInstance[];
  active: string | null;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState<"all" | "curseforge" | "modrinth">("all");
  const { data: search } = useMinecraftPackSearch(debounced, source);

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const activeInstance = instances.find((i) => i.slug === active);

  function setError(key: string, message: string | null) {
    setErrors((e) => {
      const next = { ...e };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  async function installAndActivate(key: string, pack: PackResult) {
    setPendingKey(key);
    setError(key, null);
    try {
      let slug: string | undefined;
      try {
        const created = await postJson("/api/minecraft/instances", { pack });
        slug = created?.slug as string | undefined;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          slug = findInstalledSlug(pack, instances) ?? undefined;
          if (!slug) throw e;
        } else {
          throw e;
        }
      }
      if (!slug) throw new Error("install did not return a slug");
      await postJson(`/api/minecraft/instances/${encodeURIComponent(slug)}/activate`);
      onChanged();
      setConfirmKey(null);
    } catch (e) {
      setError(key, e instanceof Error ? e.message : "install failed");
    } finally {
      setPendingKey(null);
    }
  }

  async function activate(key: string, slug: string) {
    setPendingKey(key);
    setError(key, null);
    try {
      await postJson(`/api/minecraft/instances/${encodeURIComponent(slug)}/activate`);
      onChanged();
      setConfirmKey(null);
    } catch (e) {
      setError(key, e instanceof Error ? e.message : "activate failed");
    } finally {
      setPendingKey(null);
    }
  }

  async function remove(key: string, slug: string) {
    setPendingKey(key);
    setError(key, null);
    try {
      const res = await fetch(`/api/minecraft/instances/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
      onChanged();
      setConfirmKey(null);
    } catch (e) {
      setError(key, e instanceof Error ? e.message : "delete failed");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Install a pack</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modpacks…"
              className="flex-1 min-w-[10rem]"
            />
            <Select
              value={source}
              onChange={(e) => setSource(e.target.value as "all" | "curseforge" | "modrinth")}
              className="w-36"
            >
              <option value="all">All sources</option>
              <option value="curseforge">CurseForge</option>
              <option value="modrinth">Modrinth</option>
            </Select>
          </div>

          {search?.curseforge === "no-key" && (
            <p className="microlabel text-warn">CurseForge search needs an API key — add it in Settings.</p>
          )}

          {!debounced ? (
            <p className="text-xs text-ink-faint">Type to search modpacks.</p>
          ) : !search ? (
            <p className="text-xs text-ink-faint">Searching…</p>
          ) : search.results.length === 0 ? (
            <p className="text-xs text-ink-faint">No results.</p>
          ) : (
            <div className="divide-y divide-line/50">
              {search.results.map((r) => {
                const key = `install:${r.source}:${r.id}`;
                return (
                  <div key={key} className="py-2 flex items-center gap-3 flex-wrap">
                    {r.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.icon} alt="" width={32} height={32} className="rounded shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-panel-2 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink truncate">{r.name}</div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        {r.loader && <Badge variant="neutral">{r.loader}</Badge>}
                        {r.mcVersion && <Badge variant="neutral">{r.mcVersion}</Badge>}
                        <span className="text-[0.68rem] text-ink-faint">
                          {compactNumber.format(r.downloads)} downloads
                        </span>
                      </div>
                    </div>
                    {confirmKey === key ? (
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="text-[0.7rem] text-ink-dim max-w-[14rem] text-right">
                          {installCopy(activeInstance?.name, r.name)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pendingKey !== null}
                          onClick={() => setConfirmKey(null)}
                        >
                          Cancel
                        </Button>
                        <Button size="sm" disabled={pendingKey !== null} onClick={() => void installAndActivate(key, r)}>
                          {pendingKey === key ? "Switching…" : "Confirm switch"}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" disabled={pendingKey !== null} onClick={() => setConfirmKey(key)}>
                        Install
                      </Button>
                    )}
                    {errors[key] && <p className="w-full text-[0.7rem] text-bad">{errors[key]}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Installed</CardTitle>
        </CardHeader>
        <CardContent>
          {instances.length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing installed yet.</p>
          ) : (
            <div className="divide-y divide-line/50">
              {instances.map((inst) => {
                const isActive = inst.slug === active;
                const activateKey = `activate:${inst.slug}`;
                const deleteKey = `delete:${inst.slug}`;
                return (
                  <div key={inst.slug} className="py-2 flex items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-ink">{inst.name}</span>
                        <Badge variant={SOURCE_VARIANT[inst.source]}>{inst.source}</Badge>
                        {isActive && <Badge variant="ok">active</Badge>}
                      </div>
                      <div className="text-[0.68rem] text-ink-faint">
                        {inst.mcVersion || "—"} · {inst.memoryGb} GB · {relativeTime(inst.createdAt)}
                      </div>
                    </div>

                    {confirmKey === activateKey ? (
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="text-[0.7rem] text-ink-dim max-w-[14rem] text-right">
                          {switchCopy(activeInstance?.name, inst.name)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pendingKey !== null}
                          onClick={() => setConfirmKey(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={pendingKey !== null}
                          onClick={() => void activate(activateKey, inst.slug)}
                        >
                          {pendingKey === activateKey ? "Switching…" : "Confirm switch"}
                        </Button>
                      </div>
                    ) : (
                      !isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingKey !== null}
                          onClick={() => setConfirmKey(activateKey)}
                        >
                          Activate
                        </Button>
                      )
                    )}

                    {confirmKey === deleteKey ? (
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="text-[0.7rem] text-ink-dim max-w-[14rem] text-right">
                          Deletes &quot;{inst.name}&quot; and its world. Can&apos;t be undone.
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pendingKey !== null}
                          onClick={() => setConfirmKey(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={pendingKey !== null}
                          onClick={() => void remove(deleteKey, inst.slug)}
                        >
                          {pendingKey === deleteKey ? "Deleting…" : "Confirm"}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isActive || pendingKey !== null}
                        title={isActive ? "deactivate first" : undefined}
                        onClick={() => setConfirmKey(deleteKey)}
                      >
                        Delete
                      </Button>
                    )}

                    {(errors[activateKey] || errors[deleteKey]) && (
                      <p className="w-full text-[0.7rem] text-bad">{errors[activateKey] || errors[deleteKey]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
