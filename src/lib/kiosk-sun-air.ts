/* THESIS: the kiosk's UV and air-quality view, pure. The server sends today's
   (or, after sunset, tomorrow's) peak UV and the current European AQI
   (weather.ts WeatherUv / WeatherAir); everything the wall says about them is
   decided here so the tests pin every string: bands, tone, the cue, "peak"
   versus "peaked", the past state, which half renders, and whether the glance
   pane is worth showing. Components only lay out what `sunAirView` returns. */

/** Mirrors weather.ts's WeatherUv / WeatherAir (that module is server-only). */
export interface SunAirUv {
  day: "today" | "tomorrow";
  peak: number;
  peakAt: string | null;
}
export interface SunAirAir {
  index: number;
}
/** The slice of the weather payload this reads. Every field is optional: a payload cached before these existed lacks them. */
export interface SunAirSource {
  uv?: SunAirUv | null;
  air?: SunAirAir | null;
  days?: Array<{ sunset?: string | null }>;
}

export type SunAirTone = "none" | "warn" | "bad";

/** Rounded peak, lower bound inclusive (WHO / BoM). */
export function uvBand(peak: number): { word: string; tone: SunAirTone } {
  if (peak >= 11) return { word: "Extreme", tone: "bad" };
  if (peak >= 8) return { word: "Very high", tone: "bad" };
  if (peak >= 6) return { word: "High", tone: "warn" };
  if (peak >= 3) return { word: "Moderate", tone: "warn" };
  return { word: "Low", tone: "none" };
}

/** European AQI (Open-Meteo), rounded. */
export function airBand(index: number): { word: string; tone: SunAirTone } {
  if (index >= 101) return { word: "Extremely poor", tone: "bad" };
  if (index >= 80) return { word: "Very poor", tone: "bad" };
  if (index >= 60) return { word: "Poor", tone: "bad" };
  if (index >= 40) return { word: "Moderate", tone: "warn" };
  if (index >= 20) return { word: "Fair", tone: "none" };
  return { word: "Good", tone: "none" };
}

export interface SunAirInlineItem {
  label: string;
  value: string;
  /** `${label} ${value}`, with the air word lower-cased ("Air fair"). */
  text: string;
  tone: SunAirTone;
}

export interface SunAirView {
  /** null: nothing to act on, so the glance pane (and its dot) drops. */
  glance: null | {
    uv: null | { caption: string; figure: string; word: string; sub: string; tone: SunAirTone };
    air: null | { caption: string; word: string; sub: string; tone: SunAirTone };
  };
  inline: { uv: SunAirInlineItem | null; air: SunAirInlineItem | null };
  /** One screen-reader sentence group for the whole pane (not including the stale note). */
  sr: string;
}

const PROTECT_FROM_UV = 3; // WHO: sun protection from UV 3
const AIR_MODERATE = 40;

/** "12:30 pm" to minutes after midnight; null if it is not that shape. */
function peakMinutes(peakAt: string | null): number | null {
  const m = peakAt?.match(/^(\d{1,2}):(\d{2}) (am|pm)$/);
  return m ? ((Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0)) * 60 + Number(m[2]) : null;
}

/** Clock part of an Open-Meteo naive local timestamp, in minutes. */
function sunsetMinutes(iso: string | null | undefined): number | null {
  const m = iso?.match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const usableUv = (u: SunAirUv | null | undefined): u is SunAirUv => !!u && Number.isFinite(u.peak);
const usableAir = (a: SunAirAir | null | undefined): a is SunAirAir => !!a && Number.isFinite(a.index);

/** `now` is the wall clock, compared with the peak time and today's sunset (both local). */
export function sunAirView(ok: SunAirSource | null | undefined, now: Date): SunAirView | null {
  const uv = usableUv(ok?.uv) ? ok.uv : null;
  const air = usableAir(ok?.air) ? ok.air : null;
  if (!ok || (!uv && !air)) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const needsCover = !!uv && uv.peak >= PROTECT_FROM_UV;
  const tomorrow = uv?.day === "tomorrow";
  const peakMin = peakMinutes(uv?.peakAt ?? null);
  const setMin = sunsetMinutes(ok.days?.[0]?.sunset);
  const peaked = !!uv && !tomorrow && peakMin !== null && nowMin >= peakMin;
  // No hourly UV in the payload, so "the need is over" is sunset.
  const past = needsCover && peaked && setMin !== null && nowMin >= setMin;
  const peakWord = peaked ? "peaked" : "peak";

  const uvB = uv ? uvBand(uv.peak) : null;
  const airB = air ? airBand(air.index) : null;
  const cue = !uv ? null : !needsCover ? "No hats needed" : tomorrow ? "Pack hats and sunscreen" : "Hats and sunscreen";
  const showPeak = needsCover && !!uv?.peakAt;
  const uvTone: SunAirTone = past ? "none" : (uvB?.tone ?? "none");
  const when = tomorrow ? "tomorrow" : "today";

  const uvCol =
    uv && uvB
      ? {
          caption: `UV ${when}${showPeak ? ` · ${peakWord} ${uv.peakAt}` : ""}`,
          figure: String(uv.peak),
          word: tomorrow ? `${uvB.word} tomorrow` : uvB.word,
          sub: past ? `Peaked ${uv.peakAt}` : (cue ?? ""),
          tone: uvTone,
        }
      : null;
  const airCol = air && airB ? { caption: "Air quality", word: airB.word, sub: `Index ${air.index}`, tone: airB.tone } : null;

  // The pane is up only when something asks for action: sun cover needed, or air Moderate or worse.
  const up = needsCover || (!!air && air.index >= AIR_MODERATE);

  const uvItem: SunAirInlineItem | null =
    uv && uvB
      ? (() => {
          const label = past ? "UV peaked" : "UV";
          const value = `${uv.peak} ${uvB.word}${tomorrow ? " tomorrow" : ""}`;
          return { label, value, text: `${label} ${value}`, tone: uvTone };
        })()
      : null;
  // Air rides along when UV needs cover or is missing, or when it is worth a line on its own.
  const quiet = !!uv && !needsCover && !!air && air.index < AIR_MODERATE;
  const airItem: SunAirInlineItem | null =
    air && airB && !quiet
      ? { label: "Air", value: airB.word, text: `Air ${airB.word.toLowerCase()}`, tone: airB.tone }
      : null;

  const sr = [
    uv && uvB ? `UV ${when} ${uv.peak}, ${uvB.word.toLowerCase()}.` : "",
    showPeak ? `${peaked ? "Peaked" : "Peak"} ${uv?.peakAt}.` : "",
    uv && !past && cue ? `${cue}.` : "",
    air && airB ? `Air quality ${airB.word.toLowerCase()}, index ${air.index}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { glance: up ? { uv: uvCol, air: airCol } : null, inline: { uv: uvItem, air: airItem }, sr };
}
