"use client";

import { useEffect } from "react";
import { BUILD_ID } from "@/lib/build-id";
import { versionBuildId } from "@/lib/client-replies";
import { autoUpdateDecision } from "@/lib/kiosk-auto-update";

const CHECK_MS = 60_000;
const KEY = "nw-kiosk-reloaded-for";
// Every kiosk dialog, sheet and takeover (both themes) carries one of these.
const OVERLAY = '[aria-modal="true"],[data-sr-overlay]';

/** Reloads the kiosk by itself once a newer build is deployed (the installed iPad app has no reload button). */
export function useKioskAutoUpdate() {
  useEffect(() => {
    let lastTouch = Date.now();
    let busy = false;
    let reloadedForMemo: string | null = null; // used when sessionStorage throws
    const touch = () => { lastTouch = Date.now(); };
    const readStored = () => {
      try { return window.sessionStorage.getItem(KEY); } catch { return null; }
    };

    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await fetch("/kiosk/api/version", { cache: "no-store" });
        const serverBuild = versionBuildId(res.ok, (await res.json()) as { buildId?: unknown });
        const verdict = autoUpdateDecision({
          pageBuild: BUILD_ID,
          serverBuild,
          reloadedFor: readStored() ?? reloadedForMemo,
          idleMs: Date.now() - lastTouch,
          overlayOpen: document.querySelector(OVERLAY) !== null,
        });
        if (verdict !== "reload") return;
        reloadedForMemo = serverBuild;
        try { window.sessionStorage.setItem(KEY, serverBuild); } catch { /* memo covers this page life */ }
        window.location.reload();
      } catch {
        // offline or an error reply: try again next tick
      } finally {
        busy = false;
      }
    };

    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const timer = setInterval(() => void check(), CHECK_MS);
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
