/**
 * Manual install path for packs that need a CurseForge API key to find via
 * search (or aren't on CurseForge/Modrinth's search index at all): drop the
 * "Server Pack" zip from a pack's CurseForge Files page directly. Metadata
 * goes on the query string, the zip in a bare FormData with one field — the
 * route proxies both straight through to mc-manager's upload endpoint
 * without ever buffering the file. One busy flag: the whole card disables
 * while a request is in flight, same one-action-at-a-time rule as the rest
 * of this page. Deliberately does not auto-activate on success — activation
 * stays the existing Installed-list flow, so a freshly uploaded pack lands
 * the same way an installed-via-search one does.
 */
"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { ApiError } from "@/lib/client";

const LOADERS = ["neoforge", "forge", "fabric"] as const;

function deriveSlug(name: string): string {
  const lowered = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return lowered || "pack";
}

export function UploadPack({ onChanged }: { onChanged: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [mcVersion, setMcVersion] = useState("");
  const [loader, setLoader] = useState<(typeof LOADERS)[number]>("neoforge");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [memoryGb, setMemoryGb] = useState("6");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = deriveSlug(name);
  const canSubmit = Boolean(file) && name.trim().length > 0 && mcVersion.trim().length > 0 && !busy;

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        slug,
        name: name.trim(),
        mcVersion: mcVersion.trim(),
        loader,
      });
      if (loaderVersion.trim()) params.set("loaderVersion", loaderVersion.trim());
      const gb = Number(memoryGb);
      if (Number.isFinite(gb) && gb > 0) params.set("memoryGb", String(gb));

      const form = new FormData();
      form.set("file", file);

      const res = await fetch(`/api/minecraft/instances/upload?${params.toString()}`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error || `HTTP ${res.status}`, res.status);

      setFile(null);
      setName("");
      setMcVersion("");
      setLoader("neoforge");
      setLoaderVersion("");
      setMemoryGb("6");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Upload size={11} /> Upload a server pack
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-ink-dim">
          Server Pack zip from a pack&apos;s CurseForge Files page — installs without a CurseForge API key.
        </p>

        <Field label="Server pack .zip">
          <input
            type="file"
            accept=".zip"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-ink-dim file:mr-3 file:h-9 file:rounded-md file:border file:border-line file:bg-panel-2 file:px-3 file:text-xs file:text-ink file:cursor-pointer disabled:opacity-40"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="ATM10" />
            </Field>
            {name.trim() && <p className="microlabel mt-1">slug: {slug}</p>}
          </div>
          <Field label="MC version">
            <Input
              value={mcVersion}
              onChange={(e) => setMcVersion(e.target.value)}
              disabled={busy}
              placeholder="1.21.1"
            />
          </Field>
          <Field label="Loader">
            <Select
              value={loader}
              onChange={(e) => setLoader(e.target.value as (typeof LOADERS)[number])}
              disabled={busy}
            >
              {LOADERS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Loader version" hint="leave blank for recommended">
            <Input
              value={loaderVersion}
              onChange={(e) => setLoaderVersion(e.target.value)}
              disabled={busy}
              placeholder="optional"
            />
          </Field>
          <Field label="Memory GB">
            <Input
              type="number"
              min={1}
              value={memoryGb}
              onChange={(e) => setMemoryGb(e.target.value)}
              disabled={busy}
            />
          </Field>
        </div>

        {error && <p className="text-xs text-bad">{error}</p>}

        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </CardContent>
    </Card>
  );
}
