/** Which one-line hint the Home launcher shows about the widget chips, if any. */
export const WIDGETS_HINT_COPY = {
  load: "Widget details can't be loaded right now.",
  stale: "Widget details may be out of date; the last refresh failed.",
} as const;

export function widgetsHint({
  widgetsError,
  widgets,
  containersError,
}: {
  widgetsError: boolean;
  /** SWR keeps the last good map while a refresh fails; undefined means none was ever loaded. */
  widgets: Record<string, unknown> | undefined;
  /** The Docker note is showing; it already explains the page. */
  containersError: boolean;
}): keyof typeof WIDGETS_HINT_COPY | null {
  if (!widgetsError || containersError) return null;
  if (!widgets) return "load";
  return Object.keys(widgets).length > 0 ? "stale" : null;
}

/** Note for one container's Service widget card; `widget` is that container's entry in the held map. */
export function containerWidgetNote({
  widgetsError,
  widgets,
  widget,
}: {
  widgetsError: boolean;
  widgets: Record<string, unknown> | undefined;
  widget: { error?: unknown; fields?: unknown[] } | undefined;
}): keyof typeof WIDGETS_HINT_COPY | null {
  if (!widgetsError) return null;
  if (!widgets) return "load";
  return widget && !widget.error && widget.fields && widget.fields.length > 0 ? "stale" : null;
}
