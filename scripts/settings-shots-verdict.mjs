// Run verdict for settings-shots.mjs: fails on any record whose value is strictly false, on an object
// record whose own `ok` is strictly false, and on a "FAIL" record in a single-section (ONLY) run.
// Strings, numbers, null, arrays and objects without ok:false never fail here.
export const shotsFailed = (checks, only) =>
  Object.entries(checks).some(([k, v]) => Object.values(v).some((x) => x === false || x?.ok === false) || (only && k === "FAIL"));
