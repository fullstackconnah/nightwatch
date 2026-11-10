"use client";

import Link from "next/link";
import { ContainerStatus, LifecycleActions, LifecycleError, OpenAppLink, useLifecycle } from "@/components/resources/container-controls";
import { stateDotClass } from "@/components/resources/container-tile";
import { hasWidgetActions, WidgetActionsMenu } from "@/components/widget-actions";
import type { TiledContainer, WidgetData } from "@/lib/client";
import { cn } from "@/lib/utils";

/** One app in the launcher: state, name link, status, widget values (never painted), start/stop/restart, open-app, widget actions. */
export function AppCard({ c, widget, onChanged }: { c: TiledContainer; widget?: WidgetData; onChanged: () => void }) {
  const lifecycle = useLifecycle(c.id, onChanged);
  const showFields = widget && (widget.error || widget.fields.length > 0);
  return (
    <div className="hm-app" data-row-id={`app:${c.name}`} data-name={c.name}>
      <div className="hm-app-main">
        <span className={cn("dot", stateDotClass(c))} aria-hidden />
        <Link href={`/containers/${c.id.slice(0, 12)}`} className="hm-app-name" data-feature="container-link">
          {c.name}
        </Link>
        <ContainerStatus c={c} className="hm-app-st text-xs" />
      </div>
      {showFields && (
        <div className="hm-app-fields" data-feature="widget-fields">
          {widget.error ? (
            <span className="text-ink-faint">widget: {widget.error}</span>
          ) : (
            // Intent is not painted here: Home stays calm, Resources owns thresholds.
            widget.fields.slice(0, 4).map((f) => (
              <span key={f.label}>
                <span className="text-ink-faint">{f.label}</span> <span className="font-mono text-ink">{f.value}</span>
              </span>
            ))
          )}
        </div>
      )}
      <div className="hm-app-acts">
        <span className="hm-act" data-feature="lifecycle">
          <LifecycleActions state={c.state} name={c.name} lifecycle={lifecycle} />
        </span>
        {c.tile.url && (
          <span className="hm-act" data-feature="open-app">
            <OpenAppLink url={c.tile.url} name={c.name} />
          </span>
        )}
        {widget && hasWidgetActions(widget) && (
          <span className="hm-act" data-feature="widget-actions">
            <WidgetActionsMenu container={c.name} widgetType={widget.type} />
          </span>
        )}
      </div>
      <LifecycleError lifecycle={lifecycle} className="hm-app-err" />
    </div>
  );
}
