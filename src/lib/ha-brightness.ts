/** 0-255 -> 0-100. Only meaningful while on and dimmable; a lit bulb never reads below 1%. */
export const brightnessPercent = (on: boolean, raw: number | null): number | null =>
  on && raw != null ? (raw > 0 ? Math.max(1, Math.round((raw / 255) * 100)) : 0) : null;
