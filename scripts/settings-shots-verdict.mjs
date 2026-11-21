// Run verdict for settings-shots.mjs: fails on any record whose value is strictly false,
// and on a "FAIL" record in a single-section (ONLY) run. Strings, numbers and objects never fail here.
export const shotsFailed = (checks, only) =>
  Object.entries(checks).some(([k, v]) => Object.values(v).includes(false) || (only && k === "FAIL"));
