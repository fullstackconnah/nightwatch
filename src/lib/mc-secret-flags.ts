/** Per-secret "is set" booleans for the Minecraft settings card; never returns a secret value. */
export function mcSecretFlags(mc?: { managerToken?: string; curseforgeKey?: string; rconPassword?: string }) {
  return {
    managerTokenSet: Boolean(mc?.managerToken),
    curseforgeKeySet: Boolean(mc?.curseforgeKey),
    rconPasswordSet: Boolean(mc?.rconPassword),
  };
}
