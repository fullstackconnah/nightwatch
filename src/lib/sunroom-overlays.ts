/* Sunroom overlays (Sill DS PR 3): the sheet drag maths and the alert chime, ported from SR bundle.js:287-289, :450-470, :534-553.
   Pure where it can be; the chime touches Web Audio and never throws when audio is missing or locked. */

/** Resistance past the top: the further the pull, the less the sheet follows (bundle.js:287). */
export function rubberband(over: number, dim: number): number {
  return (over * dim * 0.55) / (dim + 0.55 * Math.abs(over));
}

/** The sheet's offset for a finger `raw` px below where it grabbed: 1:1 down, rubber-banded up. */
export function sheetDragY(raw: number, h: number): number {
  return raw < 0 ? rubberband(raw, h) : raw;
}

/** Dismiss past 40% of the height or on a quick downward flick; never on an upward pull (bundle.js:289). */
export function shouldDismiss(dy: number, h: number, v: number): boolean {
  return dy > 0 && (dy > 0.4 * h || v > 0.11);
}

/** Where a closing sheet ends: 100% down, or (reduced motion) faded in place. */
export function sheetExitFrame(reduced: boolean): PropertyIndexedKeyframes {
  return reduced ? { opacity: 0 } : { transform: "translateY(100%)" };
}

/** Release velocity in px/ms from [timeStamp, raw] samples; a finger that paused over 80 ms before lifting has none. */
export function releaseVelocity(pts: [number, number][], endT: number): number {
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (!a || endT - b[0] > 80 || b[0] === a[0]) return 0;
  return (b[1] - a[1]) / (b[0] - a[0]);
}

export const CHIME_GAP_MS = 30000;
export const chimeDue = (last: number | null, now: number, gap = CHIME_GAP_MS) => last === null || now - last >= gap;

let ctx: AudioContext | null = null;
let lastChimeAt: number | null = null;

function audio(): AudioContext | null {
  try {
    const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}

/** Browsers keep audio locked until a gesture; call this from the first touch so later takeovers can sound. */
export function unlockAudio(): void {
  audio();
}

/** E5 then C5, a calm falling third. At most every 30 s; false (and no gap used) while audio is locked or missing. */
export function playChime(now = Date.now()): boolean {
  if (!chimeDue(lastChimeAt, now)) return false;
  const a = audio();
  if (!a || a.state !== "running") return false;
  try {
    const t0 = a.currentTime + 0.02;
    for (const [freq, at] of [[659.25, 0], [523.25, 0.32]] as const) {
      const osc = a.createOscillator();
      const g = a.createGain();
      const t = t0 + at;
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      osc.connect(g);
      g.connect(a.destination);
      osc.start(t);
      osc.stop(t + 1.45);
    }
    lastChimeAt = now;
    return true;
  } catch {
    return false;
  }
}
