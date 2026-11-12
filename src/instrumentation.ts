export async function register() {
  // Node runtime only (never edge), and register() runs when a server instance starts, not during `next build`.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTelemetryRecorder } = await import("@/lib/telemetry");
    startTelemetryRecorder();
  }
}
