// State of the first /api/resources load. Kept data with a failing refresh stays "ready": the header's "updated … ago" shows its age.
export type ResourcesLoad = "ready" | "loading" | "failed";

export const resourcesLoad = ({ data, error }: { data: unknown; error: unknown }): ResourcesLoad =>
  data ? "ready" : error ? "failed" : "loading";
