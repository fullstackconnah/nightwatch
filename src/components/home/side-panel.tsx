"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BackupTile } from "@/components/resources/backup-tile";
import { useHost } from "@/lib/client";
import { formatRate } from "@/lib/format";
import { useOrchestraStatus } from "@/lib/use-orchestra";
import { cn } from "@/lib/utils";

// attention.ts's DISK_WARN_PCT lives in a server-only module; the one real threshold, restated for the client.
const DISK_WARN_PCT = 85;

function Cell({ label, width, tone, children }: { label: string; width: string; tone?: "warn"; children: React.ReactNode }) {
  return (
    <span className="hm-dg-cell">
      <span className="hm-dg-l">{label}</span>
      <span className={cn("hm-dg-v font-mono", tone === "warn" ? "text-warn" : "text-ink")} style={{ minWidth: width }}>
        {children}
      </span>
    </span>
  );
}

/** The box in one line. Numbers only change text, in fixed-width cells. */
function Digest() {
  const { data: x } = useHost(5000);
  const days = x ? Math.floor(x.uptimeSeconds / 86400) : 0;
  const hours = x ? Math.floor((x.uptimeSeconds % 86400) / 3600) : 0;
  return (
    <section data-feature="box-digest" aria-label="Box">
      <div className="hm-sec-head">
        <h2 className="microlabel">Box</h2>
        <span className="flex-1" />
        <Link href="/resources" className="hm-link" data-feature="resources-link">
          Charts and containers in Resources
        </Link>
      </div>
      <div className="hm-dg-row">
        <Cell label="CPU" width="5.5ch">{x ? `${x.cpu.percent.toFixed(1)}%` : "—"}</Cell>
        <Cell label="Memory" width="3.5ch">{x ? `${Math.round(x.memory.percent)}%` : "—"}</Cell>
        <Cell label="Disks" width="11ch" tone={x?.disk.some((d) => d.percent >= DISK_WARN_PCT) ? "warn" : undefined}>
          {x ? `${x.disk.map((d) => Math.round(d.percent)).join(" · ")}%` : "—"}
        </Cell>
        <Cell label="Temp" width="4.5ch">{x?.tempC == null ? "—" : `${x.tempC.toFixed(0)}°C`}</Cell>
        <Cell label="Network" width="20ch">{x ? `↓ ${formatRate(x.network.rxPerSec)} ↑ ${formatRate(x.network.txPerSec)}` : "—"}</Cell>
        <Cell label="Up" width="9ch">{x ? `${days} d ${hours} h` : "—"}</Cell>
      </div>
    </section>
  );
}

function Lanes() {
  const { data } = useOrchestraStatus();
  let text = "checking…";
  if (data?.status === "ok") {
    const by = (s: string) => data.orchestrators.filter((o) => o.state === s).length;
    text = [by("stalled") && `${by("stalled")} stuck`, `${by("running")} running`, by("stopped") && `${by("stopped")} stopped`]
      .filter(Boolean)
      .join(", ");
  } else if (data) text = "not reachable";
  return (
    <Link href="/orchestrators" className="hm-lanes" data-feature="orchestra-link">
      <span className="microlabel">AI lanes</span>
      <span className="text-xs text-ink">{text}</span>
      <ChevronRight size={14} className="ml-auto text-ink-faint" aria-hidden />
    </Link>
  );
}

export function SidePanel() {
  return (
    <div className="panel hm-side">
      <Digest />
      {/* The detail stays on Home (R5); `#backup` from an owner link scrolls here. */}
      <div id="backup" data-feature="backup" className="hm-bk">
        <BackupTile stacked />
      </div>
      <Lanes />
    </div>
  );
}
