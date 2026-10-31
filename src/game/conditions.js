/**
 * Match conditions: the sky, the wind, the pitch and the outfield. Chosen on
 * the intro card (or rolled at random) and fixed for the match. Each choice
 * maps to a few numbers the ball reads:
 *
 *   sky        swing: cloud and humidity keep the shine swinging, sun kills it
 *   wind       a cross-wind adds drift to the delivery; every ball in the air
 *              after the bat feels it (a following wind carries a lofted drive)
 *   pitch      seam movement, bounce (height at the stumps), how uneven the
 *              bounce is, and how much pace the ball keeps off the surface
 *   outfield   how fast a ball rolls along the ground (and so the boundaries)
 *
 * The AI knows them too: it bowls more swing under cloud and more cutters and
 * bouncers on a pitch that helps them.
 *
 * World axes: +x is toward the bowler's end, +z the off side.
 */
export const SKY = {
  sunny: { name: 'Sunny', icon: '☀', swing: 0.7, light: { sun: 1.12, hemi: 0.9, tint: 0xfff4e0 } },
  cloudy: { name: 'Patchy cloud', icon: '⛅', swing: 1.0, light: { sun: 0.9, hemi: 1.0, tint: 0xfff8ee } },
  overcast: { name: 'Overcast', icon: '☁', swing: 1.4, light: { sun: 0.55, hemi: 1.35, tint: 0xe6ecf2 } },
  humid: { name: 'Heavy and humid', icon: '🌫', swing: 1.75, light: { sun: 0.42, hemi: 1.45, tint: 0xdfe6e6 } },
};
export const WIND = {
  calm: { name: 'Calm', speed: 0 },
  breeze: { name: 'Breeze', speed: 3.5 },
  strong: { name: 'Strong', speed: 7 },
};
/** Where the wind blows TO (a unit vector in world x/z). */
export const WIND_DIR = {
  atBatter: { name: 'in the batter’s face', short: 'into the batter', v: [-1, 0] },
  atBowler: { name: 'at the batter’s back', short: 'behind the batter', v: [1, 0] },
  offSide: { name: 'toward the off side', short: 'to off', v: [0, 1] },
  legSide: { name: 'toward the leg side', short: 'to leg', v: [0, -1] },
};
export const PITCH = {
  flat: { name: 'Flat road', seam: 0.6, bounce: 0.95, uneven: 0.6, keep: 0.93, color: '#dccb98' },
  standard: { name: 'Good cricket pitch', seam: 1.0, bounce: 1.0, uneven: 1.0, keep: 0.9, color: '#d8c592' },
  green: { name: 'Green top', seam: 1.7, bounce: 1.1, uneven: 1.2, keep: 0.92, color: '#b9c483' },
  dusty: { name: 'Dry and dusty', seam: 1.25, bounce: 0.86, uneven: 1.7, keep: 0.86, color: '#ccb27a' },
  cracked: { name: 'Cracked', seam: 1.35, bounce: 1.0, uneven: 2.5, keep: 0.89, color: '#c8b685' },
};
export const OUTFIELD = {
  slow: { name: 'Slow, lush', roll: 1.35 },
  standard: { name: 'Normal', roll: 1.0 },
  fast: { name: 'Fast, dry', roll: 0.72 },
};
export const GROUPS = [
  ['sky', 'SKY · SWING', SKY],
  ['wind', 'WIND', WIND],
  ['windDir', 'BLOWING', WIND_DIR],
  ['pitch', 'PITCH · SEAM AND BOUNCE', PITCH],
  ['outfield', 'OUTFIELD', OUTFIELD],
];

export const DEFAULT = { sky: 'cloudy', wind: 'breeze', windDir: 'offSide', pitch: 'standard', outfield: 'standard' };

/** Odds for a random day: mostly ordinary, now and then something to deal with. */
const ODDS = {
  sky: { sunny: 3, cloudy: 4, overcast: 2, humid: 1 },
  wind: { calm: 2, breeze: 4, strong: 1.5 },
  windDir: { atBatter: 1, atBowler: 1, offSide: 1, legSide: 1 },
  pitch: { flat: 2, standard: 4, green: 1.5, dusty: 1.5, cracked: 1 },
  outfield: { slow: 1.5, standard: 3, fast: 2 },
};
export function randomConditions(rnd = Math.random) {
  const out = {};
  for (const [g, w] of Object.entries(ODDS)) {
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    out[g] = Object.keys(w).find((k) => (r -= w[k]) < 0) ?? Object.keys(w)[0];
  }
  return out;
}

/** A selection (any missing or unknown key falls back to the default) to the numbers. */
export function resolveConditions(sel = {}) {
  const c = { ...DEFAULT };
  for (const [g, , table] of GROUPS) if (table[sel[g]]) c[g] = sel[g];
  const sky = SKY[c.sky];
  const pitch = PITCH[c.pitch];
  const ws = WIND[c.wind].speed;
  const [wx, wz] = WIND_DIR[c.windDir].v;
  return {
    sel: c,
    swing: sky.swing,
    seam: pitch.seam,
    bounce: pitch.bounce,
    uneven: pitch.uneven,
    keep: pitch.keep,
    roll: OUTFIELD[c.outfield].roll,
    wind: { x: wx * ws, z: wz * ws },
    light: sky.light,
    pitchColor: pitch.color,
  };
}

/** Standard conditions: what the game played like before conditions existed. */
export const NEUTRAL = resolveConditions({ sky: 'cloudy', wind: 'calm', windDir: 'offSide', pitch: 'standard', outfield: 'standard' });

export function describeConditions(sel) {
  const c = resolveConditions(sel).sel;
  const w = WIND[c.wind];
  const wind = w.speed ? `${w.name} ${Math.round(w.speed * 3.6)} km/h ${WIND_DIR[c.windDir].short}` : 'No wind';
  return { sky: `${SKY[c.sky].icon} ${SKY[c.sky].name}`, wind, pitch: PITCH[c.pitch].name, outfield: `${OUTFIELD[c.outfield].name} outfield` };
}

const STORE = 'chase-conditions-v1';
/** The last choice on this browser: { sel, random }. */
export function loadChoice() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (s && s.sel) return { sel: { ...DEFAULT, ...s.sel }, random: !!s.random };
  } catch {}
  return { sel: { ...DEFAULT }, random: false };
}
export function saveChoice(choice) {
  try {
    localStorage.setItem(STORE, JSON.stringify(choice));
  } catch {}
}
