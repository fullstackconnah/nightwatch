"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
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
    <div className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-10">
      <div className="panel w-full max-w-lg p-5 space-y-4 relative">
        <button onClick={onClose} className="absolute right-3 top-3 text-ink-dim hover:text-ink cursor-pointer">
          <X size={16} />
        </button>
        <div>
          <h2 className="text-base font-semibold">New container</h2>
          <p className="text-xs text-ink-dim mt-0.5">
            Pulls the image and starts it. For compose stacks use Dockge instead.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Image *</Label>
            <Input placeholder="nginx:alpine" value={image} onChange={(e) => setImage(e.target.value)} />
          </div>
          <div>
            <Label>Name</Label>
            <Input placeholder="(auto)" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Restart policy</Label>
            <Select value={restart} onChange={(e) => setRestart(e.target.value)}>
              <option value="unless-stopped">unless-stopped</option>
              <option value="always">always</option>
              <option value="on-failure">on-failure</option>
              <option value="no">no</option>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Network (blank = bridge)</Label>
            <Input placeholder="homelab_default" value={network} onChange={(e) => setNetwork(e.target.value)} />
          </div>
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
            <div key={i} className="flex gap-2 mb-1.5">
              <Input placeholder="8080" value={p.host} onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)))} />
              <Input placeholder="80" value={p.container} onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, container: e.target.value } : x)))} />
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
            <div key={i} className="flex gap-2 mb-1.5">
              <Input placeholder="KEY" value={e2.key} onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <Input placeholder="value" value={e2.value} onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
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
            <div key={i} className="flex gap-2 mb-1.5 items-center">
              <Input placeholder="/mnt/docker/thing" value={v.host} onChange={(e) => setVols(vols.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)))} />
              <Input placeholder="/data" value={v.container} onChange={(e) => setVols(vols.map((x, j) => (j === i ? { ...x, container: e.target.value } : x)))} />
              <label className="flex items-center gap-1 text-xs text-ink-dim whitespace-nowrap cursor-pointer">
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
