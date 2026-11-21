"use client";

import { useRef, useState } from "react";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Select } from "@/components/ui/input";
import { ApiError, postJson } from "@/lib/client";
import { checkRows, createFailedCopy, type EnvRow, type PortRow, type VolRow } from "@/lib/create-form";

/**
 * One-off container creation. Compose-based stacks stay in Dockge — this is
 * deliberately only for quick single containers.
 */
export function CreateContainerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [network, setNetwork] = useState("");
  const [restart, setRestart] = useState("unless-stopped");
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [vols, setVols] = useState<VolRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  // Initial focus lands on the first field, not the close button — same
  // reasoning as kiosk-pin-pad.tsx's pin keys. Restoring focus to whatever
  // opened the dialog on unmount (Cancel, a successful create, or Escape all
  // unmount this component the same way) keeps a keyboard user anchored
  // instead of dumped at document top.
  const onTab = useDialogFocus(true, dialogRef, () => imageInputRef.current);

  // Escape closes the dialog; Tab/Shift+Tab cycle within its own focusable
  // elements — identical pattern to kiosk-pin-pad.tsx's onDialogKeyDown,
  // handled as a React onKeyDown (bubbles from whatever is focused) rather
  // than a document listener, so there's nothing to leak on unmount. The
  // element list is recomputed on every Tab press rather than cached, since
  // add/remove row buttons change it while the dialog is open.
  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onClose(); // a pull in flight must report its result or error here
      return;
    }
    onTab(e);
  }

  async function submit() {
    if (busy) return; // the busy button stays focusable (aria-disabled), so a second click or Enter lands here
    setError(null);
    const rows = checkRows(ports, env, vols);
    if ("error" in rows) {
      setError(rows.error);
      return;
    }
    setBusy(true);
    submitRef.current?.focus(); // disabling Cancel (or this button) would drop focus onto the dialog and ring it
    try {
      await postJson("/api/docker/containers", {
        image: image.trim(),
        name: name.trim() || undefined,
        network: network.trim() || undefined,
        restartPolicy: restart,
        ports: rows.ports,
        env: rows.env,
        volumes: rows.volumes,
      });
      onCreated();
    } catch (e) {
      setError(createFailedCopy(e instanceof Error ? e.message : undefined, e instanceof ApiError ? e.status : undefined, typeof navigator !== "undefined" && navigator.onLine === false));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] md:py-10"
      // Same guard as kiosk-pin-pad.tsx's scrim: a tap that lands on the
      // backdrop itself (not a real control inside the dialog) would
      // otherwise blur whatever is focused with nothing to receive it,
      // fighting the Tab trap below. target===currentTarget keeps this from
      // ever suppressing a real control's own pointerdown. This does not
      // close the dialog — that stays Cancel/Escape only, so a stray tap
      // can't silently discard a typed image name or port list.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-container-title"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="panel w-full max-w-lg p-5 space-y-4 relative"
      >
        <button
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          className="absolute right-1 top-1 h-11 w-11 md:h-8 md:w-8 flex items-center justify-center text-ink-dim hover:text-ink cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
        >
          <X size={16} />
        </button>
        <div>
          <h2 id="create-container-title" className="text-base font-semibold">New container</h2>
          <p className="text-xs text-ink-dim mt-0.5">
            Pulls the image and starts it. For compose stacks use Dockge instead.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Image" required className="col-span-2">
            <Input ref={imageInputRef} placeholder="nginx:alpine" value={image} onChange={(e) => setImage(e.target.value)} />
          </Field>
          <Field label="Name">
            <Input placeholder="(auto)" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Restart policy">
            <Select value={restart} onChange={(e) => setRestart(e.target.value)}>
              <option value="unless-stopped">unless-stopped</option>
              <option value="always">always</option>
              <option value="on-failure">on-failure</option>
              <option value="no">no</option>
            </Select>
          </Field>
          <Field label="Network (blank = bridge)" className="col-span-2">
            <Input placeholder="homelab_default" value={network} onChange={(e) => setNetwork(e.target.value)} />
          </Field>
        </div>

        {/* ports */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="!mb-0">Ports (host → container)</Label>
            <Button size="sm" variant="ghost" onClick={() => setPorts([...ports, { host: "", container: "", protocol: "tcp" }])}>
              <Plus size={12} /> add
            </Button>
          </div>
          {ports.map((p, i) => (
            <div key={i} className="flex flex-wrap gap-2 mb-1.5">
              <Input aria-label={`Host port ${i + 1}`} placeholder="8080" value={p.host} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)))} />
              <Input aria-label={`Container port ${i + 1}`} placeholder="80" value={p.container} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, container: e.target.value } : x)))} />
              <Select aria-label={`Protocol ${i + 1}`} className="w-20" value={p.protocol} onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, protocol: e.target.value as "tcp" | "udp" } : x)))}>
                <option>tcp</option>
                <option>udp</option>
              </Select>
              <Button size="icon" variant="ghost" aria-label={`Remove port ${i + 1}`} onClick={() => setPorts(ports.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </section>

        {/* env */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="!mb-0">Environment</Label>
            <Button size="sm" variant="ghost" onClick={() => setEnv([...env, { key: "", value: "" }])}>
              <Plus size={12} /> add
            </Button>
          </div>
          {env.map((e2, i) => (
            <div key={i} className="flex flex-wrap gap-2 mb-1.5">
              <Input aria-label={`Variable name ${i + 1}`} placeholder="KEY" value={e2.key} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <Input aria-label={`Variable value ${i + 1}`} placeholder="value" value={e2.value} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button size="icon" variant="ghost" aria-label={`Remove variable ${i + 1}`} onClick={() => setEnv(env.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </section>

        {/* volumes */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="!mb-0">Volumes (host path → container path)</Label>
            <Button size="sm" variant="ghost" onClick={() => setVols([...vols, { host: "", container: "", readonly: false }])}>
              <Plus size={12} /> add
            </Button>
          </div>
          <p className="text-xs text-ink-dim mb-1.5">Host folders mount read-only and must already exist.</p>
          {vols.map((v, i) => (
            <div key={i} className="flex flex-wrap gap-2 mb-1.5 items-center">
              <Input aria-label={`Host path ${i + 1}`} placeholder="/mnt/media/thing" value={v.host} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setVols(vols.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)))} />
              <Input aria-label={`Container path ${i + 1}`} placeholder="/data" value={v.container} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setVols(vols.map((x, j) => (j === i ? { ...x, container: e.target.value } : x)))} />
              <Button size="icon" variant="ghost" aria-label={`Remove volume ${i + 1}`} onClick={() => setVols(vols.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </section>

        {error && <p role="alert" className="text-bad text-xs">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            ref={submitRef}
            onClick={submit}
            disabled={!image.trim()}
            aria-disabled={busy || undefined}
            className="aria-disabled:opacity-40 aria-disabled:pointer-events-none"
          >
            {busy ? "Pulling & starting…" : "Create & start"}
          </Button>
        </div>
      </div>
    </div>
  );
}
