/**
 * Scene constants and the small pure helpers every module shares. Values are
 * metres and seconds. +X is the bowler's end, -X the striker's end; +Z is the
 * off side of a right-handed batter, which is the camera side.
 */
export const SLAB = { hx: 20, hz: 7, thick: 0.42 };

export const LOOP = 46.0;
export const DT = 1 / 40;
/** Timeline domain is [SEAM, SEAM + LOOP): earlier times wrap forward. */
export const SEAM = 3.0;

export const PITCH = {
  strikerStumps: -9.0,
  bowlerStumps: 11.12, // 20.12 m stumps to stumps
  crease: 1.22, // popping crease in front of the stumps
  halfWidth: 1.525, // the prepared strip is 3.05 m wide
  stumpH: 0.711,
};
PITCH.strikerCrease = PITCH.strikerStumps + PITCH.crease;
PITCH.bowlerCrease = PITCH.bowlerStumps - PITCH.crease;

/** The ball is drawn 2.5x real size so it survives the palette snap. */
export const BALL_R = 0.09;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
export const win = (t, t0, t1) => clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1);
export const bell = (t, t0, t1) => Math.sin(Math.PI * win(t, t0, t1));
export const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Map a page clock value into the timeline domain [SEAM, SEAM + LOOP). Clock 0 is
 * domain 3, so the one identity swap in the loop (incoming batter B hands over to
 * an identical batter A in the identical stance) falls exactly on the loop seam.
 */
export function domainTime(T) {
  const t = ((T % LOOP) + LOOP) % LOOP;
  return t + SEAM;
}
/** Domain time -> page clock (what ?t= and the QA scripts use). */
export const clockTime = (d) => (((d - SEAM) % LOOP) + LOOP) % LOOP;

/** Deck height at a point. The outfield is flat; the pitch sits 4 mm proud. */
export function groundY() {
  return 0;
}
