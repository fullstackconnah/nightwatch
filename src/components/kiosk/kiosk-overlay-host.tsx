"use client";

/* The one overlay host (Sill DS PR 3, rule 2). Under Sunroom every overlay mounts here through KioskPortal: a direct
   child of the theme scope div, so it inherits the --sr-* values and fonts, and nothing from here up to the root carries
   a transform, filter or perspective (so `.kiosk-rise` cannot trap a position:fixed overlay). Other themes keep rendering
   their overlays inline, exactly as before. */

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const HostContext = createContext<HTMLElement | null>(null);

export function OverlayHostProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <HostContext.Provider value={enabled ? host : null}>
      {children}
      {enabled && <div data-sr-overlay-host ref={setHost} />}
    </HostContext.Provider>
  );
}

/** Renders `children` into the overlay host when there is one (Sunroom), otherwise in place. */
export function KioskPortal({ children }: { children: ReactNode }) {
  const host = useContext(HostContext);
  return host ? createPortal(children, host) : <>{children}</>;
}
