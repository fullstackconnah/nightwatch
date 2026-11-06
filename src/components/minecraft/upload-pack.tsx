/**
 * Manual install path for packs that need a CurseForge API key to find via
 * search (or aren't on CurseForge/Modrinth's search index at all): drop the
 * "Server Pack" zip from a pack's CurseForge Files page directly. Metadata
 * goes on the query string, the zip in a bare FormData with one field; the
 * route proxies both straight through to mc-manager's upload endpoint
 * without ever buffering the file. The write uses the strips pattern's one
 * idiom (WriteAction). Deliberately does not auto-activate on success:
 * activation stays the Installed-list flow, so an uploaded pack lands the
 * same way an installed-via-search one does.
 */
"use client";

import { useState } from "react";
import { WriteAction } from "@/components/strips/write-action";
import { Field, Input, Select } from "@/components/ui/input";
import { ApiError } from "@/lib/client";
import { memoryGbError } from "@/lib/minecraft/memory-gb";

const LOADERS = ["neoforge", "forge", "fabric"] as const;

function deriveSlug(name: string): string {
  const lowered = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return lowered || "pack";
}

export function UploadPack({
  onChanged,
  disabled,
  onPending,
}: {
  onChanged: () => void;
  /** Another pack write is in flight, or the server is not answering. */
  disabled?: boolean;
  onPending?: (pending: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [mcVersion, setMcVersion] = useState("");
  const [loader, setLoader] = useState<(typeof LOADERS)[number]>("neoforge");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [memoryGb, setMemoryGb] = useState("6");
  const [busy, setBusy] = useState(false);

  const slug = deriveSlug(name);
  const memoryError = memoryGbError(memoryGb);
  const canSubmit = Boolean(file) && name.trim().length > 0 && mcVersion.trim().length > 0 && !memoryError;
  const off = busy || disabled;

  async function submit() {
    if (!file) return;
    const params = new URLSearchParams({ slug, name: name.trim(), mcVersion: mcVersion.trim(), loader });
    if (loaderVersion.trim()) params.set("loaderVersion", loaderVersion.trim());
    const gb = Number(memoryGb);
    if (Number.isFinite(gb) && gb > 0) params.set("memoryGb", String(gb));

    const form = new FormData();
    form.set("file", file);

    const res = await fetch(`/api/minecraft/instances/upload?${params.toString()}`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error || `HTTP ${res.status}`, res.status);

    setFile(null);
    setName("");
    setMcVersion("");
    setLoader("neoforge");
    setLoaderVersion("");
    setMemoryGb("6");
    onChanged();
  }

  return (
    <section className="st-stack" aria-label="Upload a server pack">
      <h3 className="microlabel">Upload a server pack</h3>
      <p className="st-note">
        Server Pack zip from a pack&apos;s CurseForge Files page. Installs without a CurseForge API key.
      </p>

      <Field label="Server pack .zip">
        <input
          type="file"
          accept=".zip"
          disabled={off}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-ink-dim file:mr-3 file:h-11 md:file:h-8 file:rounded-md file:border file:border-line file:bg-panel-2 file:px-3 file:text-xs file:text-ink file:cursor-pointer disabled:opacity-40"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={off} placeholder="ATM10" />
          </Field>
          {name.trim() && <p className="microlabel mt-1">slug: {slug}</p>}
        </div>
        <Field label="MC version" required>
          <Input value={mcVersion} onChange={(e) => setMcVersion(e.target.value)} disabled={off} placeholder="1.21.1" />
        </Field>
        <Field label="Loader">
          <Select value={loader} onChange={(e) => setLoader(e.target.value as (typeof LOADERS)[number])} disabled={off}>
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
            disabled={off}
            placeholder="optional"
          />
        </Field>
        <Field label="Memory GB" error={memoryError}>
          <Input type="number" min={1} value={memoryGb} onChange={(e) => setMemoryGb(e.target.value)} disabled={off} />
        </Field>
      </div>

      <div>
        <WriteAction
          label="Upload"
          say={`Uploads ${file?.name ?? "the file"} as ${name.trim() || "the pack"}.`}
          yes="Yes, upload"
          flight="Uploading…"
          failure="Couldn’t upload the pack"
          disabled={off || !canSubmit}
          onPending={(p) => {
            setBusy(p);
            onPending?.(p);
          }}
          run={submit}
        />
      </div>
    </section>
  );
}
