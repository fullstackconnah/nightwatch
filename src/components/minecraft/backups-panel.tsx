/**
 * World backups: trigger one on demand (only while the server is running —
 * mc-manager snapshots the live world), and restore from any prior one
 * (only while stopped — restoring into a running world is the one operation
 * this panel refuses to offer rather than let the operator discover why it
 * failed). Own pendingKey/confirmKey pair, same inline two-step pattern as
 * PackBrowser.
 */
"use client";

import { useState } from "react";
import { Archive, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson, useMinecraftBackups } from "@/lib/client";
import { relativeTime } from "@/lib/format";

const RESTORE_COPY =
  "Stops nothing — restore only runs while the server is stopped. Current world is kept as data.pre-restore-*.";

export function BackupsPanel({ containerState }: { containerState: string | undefined }) {
  const { data, mutate } = useMinecraftBackups();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const running = containerState === "running";
  const backups = data?.backups ?? [];

  function setError(key: string, message: string | null) {
    setErrors((e) => {
      const next = { ...e };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  async function runBackup() {
    setPendingKey("run");
    setError("run", null);
    try {
      await postJson("/api/minecraft/backups", { action: "run" });
      await mutate();
    } catch (e) {
      setError("run", e instanceof Error ? e.message : "backup failed");
    } finally {
      setPendingKey(null);
    }
  }

  async function restore(key: string, instance: string, file: string) {
    setPendingKey(key);
    setError(key, null);
    try {
      await postJson("/api/minecraft/backups", { action: "restore", instance, file });
      await mutate();
      setConfirmKey(null);
    } catch (e) {
      setError(key, e instanceof Error ? e.message : "restore failed");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Archive size={11} /> Backups
        </CardTitle>
        <Button
          size="sm"
          disabled={!running || pendingKey !== null}
          title={running ? undefined : "start the server first"}
          onClick={() => void runBackup()}
        >
          {pendingKey === "run" && <RotateCw size={13} className="animate-spin" />}
          Back up now
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {errors.run && <p className="text-[0.7rem] text-bad">{errors.run}</p>}
        {backups.length === 0 ? (
          <p className="text-xs text-ink-faint">No backups yet.</p>
        ) : (
          <div className="divide-y divide-line/50">
            {backups.map((b) => {
              const key = `${b.instance}/${b.file}`;
              return (
                <div key={key} className="py-2 flex items-center gap-3 flex-wrap text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-ink truncate">{b.file}</div>
                    <div className="text-ink-faint">
                      {b.instance} · {(b.sizeBytes / 1048576).toFixed(1)} MB · {relativeTime(b.modifiedAt)}
                    </div>
                  </div>
                  {confirmKey === key ? (
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <span className="text-[0.7rem] text-ink-dim max-w-[16rem]">{RESTORE_COPY}</span>
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
                        onClick={() => void restore(key, b.instance, b.file)}
                      >
                        {pendingKey === key ? "Restoring…" : "Confirm"}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={running || pendingKey !== null}
                      title={running ? "stop the server first" : undefined}
                      onClick={() => setConfirmKey(key)}
                    >
                      Restore
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
  );
}
