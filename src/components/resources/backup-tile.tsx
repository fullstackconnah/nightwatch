"use client";

import { DatabaseBackup } from "lucide-react";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBackupStatus } from "@/lib/client";
import { useNow } from "@/lib/use-now";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BACKUP_KIND_LABEL, BACKUP_TONE, summarizeBackup } from "@/lib/backup-status";

/** A one-line state with a dot, plus a quieter second line saying what is true. */
function Notice({ dot, title, children }: { dot: string; title: string; children: React.ReactNode }) {
  return (
    <div className="text-xs">
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <span className={cn("dot", dot)} aria-hidden />
        {title}
      </p>
      <p className="mt-1 pl-4 text-[0.7rem] text-ink-dim">{children}</p>
    </div>
  );
}

/** ODIP's nightly backup and weekly restore test, read from the host's daily status file. */
export function BackupTile() {
  const { data, error } = useBackupStatus();
  // No timer: the Overview's own polls re-render this tile, and an hour-scale
  // age doesn't need a 1 Hz clock.
  const now = useNow(false);
  const summary = data?.status === "ok" && now > 0 ? summarizeBackup(data, now) : null;

  let body: React.ReactNode;
  if (error && !data) {
    body = (
      <Notice dot="dot-unhealthy" title="Backup status unreadable">
        <span className="font-mono">{error.message}</span>
      </Notice>
    );
  } else if (!data || now === 0) {
    body = <p className="text-xs text-ink-faint">reading backup status…</p>;
  } else if (data.status === "missing") {
    body = (
      <Notice dot="dot-stopped" title="No backup status yet">
        The daily check hasn&apos;t written its status file.
      </Notice>
    );
  } else if (data.status === "unreadable") {
    body = (
      <Notice dot="dot-unhealthy" title="Backup status unreadable">
        <span className="font-mono">{data.reason}</span>
      </Notice>
    );
  } else if (summary) {
    body = (
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
        {summary.items.map((item) => {
          const tone = BACKUP_TONE[item.state];
          return (
            <li key={item.kind} className="flex items-center gap-2 min-w-0 text-xs">
              <span className={cn("dot", tone.dot)} aria-hidden />
              <span className="truncate text-ink">{BACKUP_KIND_LABEL[item.kind]}</span>
              <span
                className="font-mono text-ink-dim whitespace-nowrap"
                title={item.at ? new Date(item.at).toLocaleString() : undefined}
              >
                {item.at ? `${item.state === "OK" ? "" : "last ok "}${relativeTime(item.at)}` : "no record"}
              </span>
              <Badge variant={tone.variant} className="ml-auto sm:ml-0">
                {item.state}
              </Badge>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="panel" aria-labelledby="backup-tile-title">
      <CardHeader className="flex-wrap gap-x-3 gap-y-1">
        <CardTitle id="backup-tile-title" className="flex items-center gap-1.5">
          <DatabaseBackup size={11} aria-hidden /> ODIP backup
        </CardTitle>
        {summary && data?.status === "ok" && (
          <span
            className={cn("microlabel", summary.checkStale && "!text-warn")}
            title={new Date(data.checkedAt).toLocaleString()}
          >
            {summary.checkStale
              ? `check last ran ${relativeTime(data.checkedAt)}`
              : `checked ${relativeTime(data.checkedAt)}`}
          </span>
        )}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </section>
  );
}
