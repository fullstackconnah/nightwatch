"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Select } from "@/components/ui/input";
import { postJson } from "@/lib/client";

interface PortRow { host: string; container: string; protocol: "tcp" | "udp" }
interface EnvRow { key: string; value: string }
interface VolRow { host: string; container: string; readonly: boolean }

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

  // Initial focus lands on the first field, not the close button — same
  // reasoning as kiosk-pin-pad.tsx's pin keys. Restoring focus to whatever
  // opened the dialog on unmount (Cancel, a successful create, or Escape all
  // unmount this component the same way) keeps a keyboard user anchored
  // instead of dumped at document top.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    imageInputRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // Escape closes the dialog; Tab/Shift+Tab cycle within its own focusable
  // elements — identical pattern to kiosk-pin-pad.tsx's onDialogKeyDown,
  // handled as a React onKeyDown (bubbles from whatever is focused) rather
  // than a document listener, so there's nothing to leak on unmount. The
  // element list is recomputed on every Tab press rather than cached, since
  // add/remove row buttons change it while the dialog is open.
  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/docker/containers", {
        image: image.trim(),
        name: name.trim() || undefined,
        network: network.trim() || undefined,
        restartPolicy: restart,
        ports: ports
          .filter((p) => p.host && p.container)
          .map((p) => ({ host: Number(p.host), container: Number(p.container), protocol: p.protocol })),
        env: env.filter((e) => e.key),
        volumes: vols.filter((v) => v.host && v.container),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
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
          aria-label="Close"
          className="absolute right-1 top-1 h-11 w-11 md:h-8 md:w-8 flex items-center justify-center text-ink-dim hover:text-ink cursor-pointer"
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
              <Input placeholder="8080" value={p.host} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)))} />
              <Input placeholder="80" value={p.container} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, container: e.target.value } : x)))} />
              <Select className="w-20" value={p.protocol} onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, protocol: e.target.value as "tcp" | "udp" } : x)))}>
                <option>tcp</option>
                <option>udp</option>
              </Select>
              <Button size="icon" variant="ghost" onClick={() => setPorts(ports.filter((_, j) => j !== i))}>
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
              <Input placeholder="KEY" value={e2.key} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <Input placeholder="value" value={e2.value} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button size="icon" variant="ghost" onClick={() => setEnv(env.filter((_, j) => j !== i))}>
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
          {vols.map((v, i) => (
            <div key={i} className="flex flex-wrap gap-2 mb-1.5 items-center">
              <Input placeholder="/mnt/docker/thing" value={v.host} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setVols(vols.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)))} />
              <Input placeholder="/data" value={v.container} className="min-w-0 flex-1 basis-[7rem]" onChange={(e) => setVols(vols.map((x, j) => (j === i ? { ...x, container: e.target.value } : x)))} />
              {/* min-h-11 md:min-h-0: same touch-floor idiom settings-tiles.tsx
                  uses for its "hide" checkbox — this one wasn't paired with
                  the `md:` half and so stayed a sub-44px target at every
                  breakpoint. */}
              <label className="flex items-center gap-1 min-h-11 md:min-h-0 text-xs text-ink-dim whitespace-nowrap cursor-pointer">
                <input type="checkbox" checked={v.readonly} onChange={(e) => setVols(vols.map((x, j) => (j === i ? { ...x, readonly: e.target.checked } : x)))} />
                ro
              </label>
              <Button size="icon" variant="ghost" onClick={() => setVols(vols.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </section>

        {error && <p className="text-bad text-xs">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !image.trim()}>
            {busy ? "Pulling & starting…" : "Create & start"}
          </Button>
        </div>
      </div>
    </div>
  );
}
