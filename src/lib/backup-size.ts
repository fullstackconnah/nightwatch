/** A backup's size in MB, or "size unknown" when the server sent no usable number. */
export const backupSizeText = (bytes: unknown): string =>
  typeof bytes === "number" && Number.isFinite(bytes) ? `${(bytes / 1048576).toFixed(1)} MB` : "size unknown";
