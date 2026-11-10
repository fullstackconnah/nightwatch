/**
 * The Backups strip: "Back up now" lives in the strip head (BackupNowSlot, only while the server runs: mc-manager
 * snapshots the live world); the detail lists backups and restores from any of them (only while stopped, and the
 * route refuses a running server too). Both use the strips pattern's one write idiom. The page owns the data.
 */
"use client";

import { WriteAction } from "@/components/strips/write-action";
import { postJson } from "@/lib/client";
import { backupReason, canRestore } from "@/lib/mc-backup-reason";
import { relativeTime } from "@/lib/format";
import { restoreSoftFailure } from "@/lib/restore-failure";
import type { McBackup } from "@/lib/minecraft/manager";
import { useState } from "react";

const RESTORE_COPY = "Replaces the current world with this backup. The current world is kept as a pre-restore copy.";

export function BackupNowSlot({
  enabled,
  describedBy,
  onChanged,
}: {
  enabled: boolean;
  describedBy?: string;
  onChanged: () => Promise<unknown> | void;
}) {
  return (
    <WriteAction
      label="Back up now"
      confirm={false}
      flight="Backing up…"
      failure="Couldn’t back up"
      disabled={!enabled}
      describedBy={describedBy}
      run={async () => {
        await postJson("/api/minecraft/backups", { action: "run" });
        await onChanged();
      }}
    />
  );
}

export function BackupsDetail({
  backups,
  error,
  loading,
  containerState,
  writesOff,
  onChanged,
}: {
  backups: McBackup[] | undefined;
  error: boolean;
  loading: boolean;
  containerState: string | undefined;
  /** The server is not answering: restore is off. */
  writesOff: boolean;
  onChanged: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = useState(false);
  const blocked = !canRestore(containerState);
  const reason = backupReason(containerState);
  return (
    <div className="st-stack">
      {reason && (
        <p id="mc-backup-reason" className="st-note">
          {reason}
        </p>
      )}
      {error && backups && <p className="text-xs text-bad">Couldn&apos;t refresh.</p>}
      {error && !backups ? (
        <p className="text-xs text-bad">Couldn&apos;t read backups.</p>
      ) : loading || !backups ? (
        <p className="st-note">Reading backups…</p>
      ) : backups.length === 0 ? (
        <p className="st-note">No backups yet.</p>
      ) : (
        <div>
          {backups.map((b) => (
            <div key={`${b.instance}/${b.file}`} className="st-li text-xs">
              <div className="st-grow">
                <div className="font-mono text-ink truncate">{b.file}</div>
                <div className="text-ink-faint">
                  {b.instance} · {(b.sizeBytes / 1048576).toFixed(1)} MB · {relativeTime(b.modifiedAt)}
                </div>
              </div>
              <WriteAction
                label="Restore"
                ariaLabel={`Restore ${b.file}`}
                say={RESTORE_COPY}
                yes="Yes, restore"
                danger
                flight="Restoring…"
                failure="Couldn’t restore"
                softFailure={restoreSoftFailure}
                disabled={blocked || writesOff || busy}
                describedBy={blocked ? "mc-backup-reason" : undefined}
                onPending={setBusy}
                run={async () => {
                  await postJson("/api/minecraft/backups", { action: "restore", instance: b.instance, file: b.file });
                  await onChanged();
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
