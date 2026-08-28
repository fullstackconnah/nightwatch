/**
 * A minimal RCON console: one command in, one response line out, scrollback
 * kept in component state only (not persisted — a fresh mount starts empty,
 * same as opening a real terminal). Disabled with an explanatory hint
 * whenever rcon isn't "ok" — booting (server up, RCON not answering yet) and
 * unconfigured (no rconHost/rconPassword in Settings) read differently, so
 * they get different copy.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, postJson } from "@/lib/client";
import { cn } from "@/lib/utils";

interface Line {
  text: string;
  kind: "cmd" | "resp" | "error";
}

function rconHint(rcon: "ok" | "unavailable" | "unconfigured"): string | null {
  if (rcon === "unavailable") return "booting — console unavailable";
  if (rcon === "unconfigured") return "RCON not configured — add it in Settings → Integrations";
  return null;
}

export function Console({ rcon }: { rcon: "ok" | "unavailable" | "unconfigured" }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const disabled = rcon !== "ok";
  const hint = rconHint(rcon);

  async function send() {
    const cmd = command.trim();
    if (!cmd || sending || disabled) return;
    setSending(true);
    setLines((l) => [...l, { text: `> ${cmd}`, kind: "cmd" }]);
    setCommand("");
    try {
      const res = await postJson("/api/minecraft/rcon", { command: cmd });
      setLines((l) => [...l, { text: String(res?.response ?? ""), kind: "resp" }]);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "command failed";
      setLines((l) => [...l, { text: message, kind: "error" }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Terminal size={11} /> Console
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div
          ref={boxRef}
          className="logbox bg-bg rounded-md border border-line p-3 h-56 overflow-y-auto text-ink-dim"
        >
          {lines.length === 0
            ? hint ?? "no output yet"
            : lines.map((l, i) => (
                <div key={i} className={cn(l.kind === "cmd" && "text-ink", l.kind === "error" && "text-bad")}>
                  {l.text}
                </div>
              ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
            placeholder={disabled ? (hint ?? "RCON unavailable") : "say hello"}
            disabled={disabled || sending}
            className="flex-1"
          />
          <Button onClick={() => void send()} disabled={disabled || sending || !command.trim()}>
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
