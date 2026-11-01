import { mulberry32 } from '../core/geometry.js';

/**
 * Rules, the ground and the difficulty table for the Chase game. Pure data and
 * math, no THREE, so the outcome model can be tuned from Node (qa/game-sim.mjs).
 *
 * World frame as in the diorama: +X is the bowler's end, the striker stands at
 * x = -7.75 facing +X, +Z is the off side of the right-handed batter.
 * Shot azimuth `az` is measured from +X toward +Z (off side positive).
 */
export const GAME = { overs: 5, wickets: 5, ballsPerOver: 6 };
/** Match lengths: overs and wickets (the short game keeps five wickets). */
export const FORMATS = {
  5: { overs: 5, wickets: 5, label: '5 overs' },
  10: { overs: 10, wickets: 10, label: '10 overs' },
  20: { overs: 20, wickets: 10, label: '20 overs (T20)' },
};

/** Real ball radius for the laws (the drawn ball is 2.5x). */
export const BALL_REAL_R = 0.036;
export const G = 9.81;

export const STRIKER = { x: -7.75, z: -0.32 };
export const NON_STRIKER = { x: 11.0, z: -1.42 };
export const NS_BACKED_UP = { x: 9.05, z: -1.45 };
/** The bowler's release point, measured from the rig at RELEASE (stage.points.rel). */
export const RELEASE_PT = { x: 9.697, y: 1.782, z: 0.453 };
/**
 * Round the wicket: the right-armer runs in on the other side of the stumps,
 * so the whole run-up shifts across (his arm, now away from the stumps, lets
 * go about 0.8 m on the leg side). The delivery is solved from there.
 */
export const ROUND_DZ = -1.25;
export const RELEASE_ROUND = { ...RELEASE_PT, z: RELEASE_PT.z + ROUND_DZ };
export const KEEPER_HOME = { x: -16.2, z: 0.55 };
export const KEEPER_AT_STUMPS = { x: -9.75, z: 0.55 };
/** Standing up to the stumps, for the spinners. */
export const KEEPER_STANDING_UP = { x: -10.15, z: 0.42 };
export const STUMPS_X = -9.0;

/**
 * Miniature oval: centre, rope, boards and slab semi-axes (x, z). Longer than
 * it is wide and centred toward the keeper, so there is room behind the
 * batter (the rope is ~18.5 m behind the striker, 32 m in front).
 */
export const OVAL = {
  cx: -1.0,
  rope: [25.2, 21.2],
  boards: [26.2, 22.2],
  slab: [29.6, 23.4],
  // The fielding circle (the "30-yard" ring), scaled with the ground: the
  // ring fielders stand inside it, the deep ones outside.
  ring: [17.6, 14.8],
};
/**
 * Fielding restrictions: in the powerplay at most two fielders outside the
 * circle, after it at most five. The powerplay is the first 30% of the
 * innings, in whole overs (6 of 20, 3 of 10, 2 of 5); a super over has none.
 */
export const POWERPLAY = { 5: 2, 10: 3, 20: 6 };
export const MAX_OUT = { powerplay: 2, after: 5 };
/** Pavilion gate in the leg-side boards, where batters come and go. */
export const GATE_PT = { x: -6.0, z: -21.3 };
export const GATE_OUT = { x: -6.0, z: -22.9 };

/** >= 1 outside the ellipse with semi-axes [a, b]. */
export function ellipseK(x, z, ab) {
  const u = (x - OVAL.cx) / ab[0];
  const v = z / ab[1];
  return u * u + v * v;
}

/** Inside the fielding circle? */
export const insideRing = (x, z) => ellipseK(x, z, OVAL.ring) < 1;

/**
 * The bowl round the slab (the stands, the banks and the land beyond), as a
 * profile of height against d, the distance out past the slab's rim along the
 * offset ellipse [a + d, b + d]. A flat apron, a grass bank, five terraces
 * (stepped where there are seats, a smooth bank elsewhere), a concourse and a
 * back wall, then rolling ground. The stadium meshes and the ball (a six
 * landing in the crowd) both read it.
 */
export const STANDS = { apron: 2, bankTop: [6, 2.2], steps: 5, tread: 1.6, rise: 0.55, concourse: 17, wall: [17, 17.6, 7.0] };
/** Seated sectors by angle round the ellipse (th = atan2(z / b, (x - cx) / a)): both sides, not behind either end. */
export const SEATED = [
  [0.5, 1.45],
  [1.6, 2.6],
  [-2.6, -2.05],
  [-1.45, -0.5],
];
export const PAVILION = [-2.0, -1.5];
export const seatedTh = (th) => SEATED.some(([a, b]) => th >= a && th <= b);
/** d (m past the slab's rim) and th for a point; d <= 0 on the slab. */
export function beyondSlab(x, z) {
  const [a, b] = OVAL.slab;
  const dx = x - OVAL.cx;
  const th = Math.atan2(z / b, dx / a);
  if (ellipseK(x, z, OVAL.slab) <= 1) return { d: 0, th };
  let lo = 0;
  let hi = 2 * Math.hypot(dx, z);
  for (let i = 0; i < 28; i++) {
    const d = (lo + hi) / 2;
    const u = dx / (a + d);
    const v = z / (b + d);
    if (u * u + v * v > 1) lo = d;
    else hi = d;
  }
  return { d: (lo + hi) / 2, th: Math.atan2(z / (b + lo), dx / (a + lo)) };
}
/** The profile's height at d, stepped or smooth. */
export function profileY(d, seated) {
  const S = STANDS;
  const [d1, y1] = S.bankTop;
  const top = y1 + S.steps * S.rise;
  if (d <= S.apron) return 0;
  if (d <= d1) return (y1 * (d - S.apron)) / (d1 - S.apron);
  const d2 = d1 + S.steps * S.tread;
  if (d < d2) return seated ? y1 + (Math.floor((d - d1) / S.tread) + 1) * S.rise : y1 + ((d - d1) / S.tread) * S.rise;
  if (d < S.wall[0]) return top;
  if (seated && d < S.wall[1]) return S.wall[2];
  return top + Math.min(7, Math.max(0, d - S.wall[1]) * 0.05);
}
/** Ground height anywhere: 0 on the slab, the bowl's profile beyond it. */
export function standHeight(x, z) {
  const { d, th } = beyondSlab(x, z);
  return d <= 0 ? 0 : profileY(d, seatedTh(th));
}

/** Distance from (x0, z0) along azimuth az to the ellipse [a, b]. */
export function rayToEllipse(x0, z0, az, ab) {
  const dx = Math.cos(az);
  const dz = Math.sin(az);
  const px = (x0 - OVAL.cx) / ab[0];
  const pz = z0 / ab[1];
  const qx = dx / ab[0];
  const qz = dz / ab[1];
  const A = qx * qx + qz * qz;
  const B = 2 * (px * qx + pz * qz);
  const C = px * px + pz * pz - 1;
  return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
}

export const DIFFICULTY = {
  easy: {
    label: 'Easy',
    target: [34, 44],
    pace: 0.62,
    window: { perfect: 0.03, sigma: 0.06, miss: 0.16 },
    fielderSpeed: 5.0,
    catchSkill: 0.85,
    guide: true,
    // The read before the ball: pitch-zone error (m), how long it shows before release, disguise rate.
    preview: { len: 0.35, line: 0.05, hideBefore: 0.25, disguise: 0 },
  },
  medium: {
    label: 'Medium',
    target: [48, 58],
    pace: 0.72,
    window: { perfect: 0.025, sigma: 0.048, miss: 0.135 },
    fielderSpeed: 5.6,
    catchSkill: 0.92,
    guide: false,
    preview: { len: 0.8, line: 0.09, hideBefore: 0.55, disguise: 0.15 },
  },
  hard: {
    label: 'Hard',
    target: [56, 66],
    pace: 0.84,
    window: { perfect: 0.02, sigma: 0.038, miss: 0.11 },
    fielderSpeed: 6.1,
    catchSkill: 0.96,
    guide: false,
    preview: { len: 1.3, line: 0.13, hideBefore: 0.85, disguise: 0.3 },
  },
};

/** Seeded RNG with the helpers the AI and the outcome model use. */
export function makeRng(seed) {
  const r = mulberry32(seed);
  const rng = () => r();
  rng.range = (a, b) => a + (b - a) * r();
  rng.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  rng.pick = (arr) => arr[Math.floor(r() * arr.length)];
  /** weights: { key: w } -> key */
  rng.weighted = (weights) => {
    let sum = 0;
    for (const k in weights) sum += Math.max(0, weights[k]);
    let x = r() * sum;
    for (const k in weights) {
      x -= Math.max(0, weights[k]);
      if (x <= 0) return k;
    }
    return Object.keys(weights)[0];
  };
  return rng;
}
