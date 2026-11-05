/**
 * The Pack strip's detail: search CurseForge and Modrinth, install a pack and make it active, and the list of what's
 * installed (switch, delete). Every write uses the strips pattern's one idiom (WriteAction); while one is in flight
 * the others are off, so two lifecycle-altering requests can't overlap.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WriteAction } from "@/components/strips/write-action";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { ApiError, postJson, useMinecraftPackSearch } from "@/lib/client";
import { relativeTime } from "@/lib/format";
import type { McInstance } from "@/lib/minecraft/manager";
import type { PackResult } from "@/lib/minecraft/packs";
import { UploadPack } from "./upload-pack";

const SOURCE_VARIANT = { curseforge: "accent", modrinth: "blue", upload: "neutral" } as const;
const SOURCE_LABEL = { curseforge: "CurseForge", modrinth: "Modrinth", upload: "an upload" } as const;
const compactNumber = new Intl.NumberFormat("en", { notation: "compact" });

/**
 * On a 409 from POST /instances (already installed), the create call never
 * returns the instance's slug, only an error. The manager's slug is a
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

export function PackBrowser({
  instances,
  active,
  onChanged,
  disabled,
  lead,
}: {
  instances: McInstance[];
  active: string | null;
  onChanged: () => void;
  /** The server is not answering: pack writes are off (R-stale). */
  disabled?: boolean;
  /** The full answer, when Pack opened by itself (R3). */
  lead?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState<"all" | "curseforge" | "modrinth">("all");
  const { data: search, error: searchError } = useMinecraftPackSearch(debounced, source);
  const [busy, setBusy] = useState(false);
  const off = disabled || busy;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  async function installAndActivate(pack: PackResult) {
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
  }

  async function activate(slug: string) {
    await postJson(`/api/minecraft/instances/${encodeURIComponent(slug)}/activate`);
    onChanged();
  }

  async function remove(slug: string) {
    const res = await fetch(`/api/minecraft/instances/${encodeURIComponent(slug)}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
    onChanged();
  }

  return (
    <div className="st-stack">
      {lead && <p className="text-sm text-ink">{lead}</p>}
      <section className="st-stack" aria-label="Install a pack">
        <h3 className="microlabel">Install a pack</h3>
        <div className="flex gap-2 flex-wrap">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modpacks…"
            aria-label="Search modpacks"
            className="flex-1 min-w-[10rem]"
          />
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as "all" | "curseforge" | "modrinth")}
            aria-label="Source"
            className="w-36"
          >
            <option value="all">All sources</option>
            <option value="curseforge">CurseForge</option>
            <option value="modrinth">Modrinth</option>
          </Select>
        </div>

        {search?.curseforge === "no-key" && (
          <p className="st-note">
            CurseForge search needs an API key. Add it in <Link href="/settings#minecraft" className="underline">Settings</Link>.
          </p>
        )}

        {!debounced ? (
          <p className="st-note">Type to search modpacks.</p>
        ) : searchError ? (
          <p className="text-xs text-bad">Couldn&apos;t search. Try again.</p>
        ) : !search ? (
          <p className="st-note">Searching…</p>
        ) : search.results.length === 0 ? (
          <p className="st-note">No results.</p>
        ) : (
          <div>
            {search.results.map((r) => (
              <div key={`${r.source}:${r.id}`} className="st-li">
                {r.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.icon} alt="" width={32} height={32} className="rounded shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded bg-panel-2 shrink-0" />
                )}
                <div className="st-grow">
                  <div className="text-sm text-ink truncate">{r.name}</div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    {r.loader && <Badge variant="neutral">{r.loader}</Badge>}
                    {r.mcVersion && <Badge variant="neutral">{r.mcVersion}</Badge>}
                    <span className="text-[0.68rem] text-ink-faint">{compactNumber.format(r.downloads)} downloads</span>
                  </div>
                </div>
                <WriteAction
                  label="Install"
                  ariaLabel={`Install ${r.name}`}
                  say={`Installs ${r.name} from ${SOURCE_LABEL[r.source]} and makes it active.`}
                  yes="Yes, install"
                  flight="Installing… first boot can take several minutes."
                  failure="Couldn’t install the pack"
                  disabled={off}
                  onPending={setBusy}
                  run={() => installAndActivate(r)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="st-stack" aria-label="Installed">
        <h3 className="microlabel">Installed</h3>
        {instances.length === 0 ? (
          <p className="st-note">Nothing installed yet.</p>
        ) : (
          <div>
            {instances.map((inst) => {
              const isActive = inst.slug === active;
              const reasonId = `mc-pack-delete-${inst.slug}`;
              return (
                <div key={inst.slug} className="st-li">
                  <div className="st-grow">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm text-ink">{inst.name}</span>
                      <Badge variant={SOURCE_VARIANT[inst.source]}>{inst.source}</Badge>
                      {isActive && <Badge variant="ok">active</Badge>}
                    </div>
                    <div className="text-[0.68rem] text-ink-faint">
                      {inst.mcVersion || "—"} · {inst.memoryGb} GB · {relativeTime(inst.createdAt)}
                    </div>
                    {isActive && (
                      <p id={reasonId} className="st-note">
                        Active · switch to another pack to delete this one
                      </p>
                    )}
                  </div>
                  {!isActive && (
                    <WriteAction
                      label="Switch"
                      ariaLabel={`Switch to ${inst.name}`}
                      say={`Makes ${inst.name} the active pack.`}
                      yes="Yes, switch"
                      flight="Switching… loading the pack can take a few minutes."
                      failure="Couldn’t switch the pack"
                      disabled={off}
                      onPending={setBusy}
                      run={() => activate(inst.slug)}
                    />
                  )}
                  <WriteAction
                    label="Delete"
                    ariaLabel={`Delete ${inst.name}`}
                    say={`Deletes ${inst.name} from the server. This can’t be undone.`}
                    yes="Yes, delete"
                    danger
                    flight="Deleting…"
                    failure="Couldn’t delete the pack"
                    disabled={off || isActive}
                    describedBy={isActive ? reasonId : undefined}
                    onPending={setBusy}
                    run={() => remove(inst.slug)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <UploadPack onChanged={onChanged} disabled={off} onPending={setBusy} />
    </div>
  );
}
