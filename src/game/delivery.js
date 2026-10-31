import { G, BALL_REAL_R, RELEASE_PT, STUMPS_X, KEEPER_HOME } from './rules.js';
import { BALL_R } from '../config.js';

/**
 * One delivery as a closed-form path, solved once at release.
 *
 * The AI's spec pins the things a bowler aims at: where it pitches (length,
 * metres in front of the striker's stumps), where it arrives at the stumps
 * (line z), how high it is there, and how much it moves in the air (swing,
 * before the bounce) and off the seam (after it). Pace sets the flight time.
 * Everything else is solved: the release velocity that lands on the bounce
 * point under gravity plus a constant lateral swing acceleration, and the
 * post-bounce velocity that reaches the line and height at the stumps.
 *
 * Positions are { x, y, z } with y the centre of the drawn ball.
 */
export const LENGTHS = {
  yorker: [0.6, 1.4],
  full: [2.2, 3.8],
  good: [4.4, 6.4],
  short: [7.0, 8.8],
  bouncer: [9.4, 11.0],
};
/** Ball height at the stumps plane per length (real ball centre, metres). */
/**
 * Height at the stumps (real ball centre, metres) across each length band:
 * the fuller end of a band is the low end. Good length spans "below the bails"
 * to "over the top", so not every good ball arrives at the top of the stumps.
 */
export const HEIGHTS = {
  yorker: [0.06, 0.22],
  full: [0.28, 0.6],
  good: [0.48, 0.98],
  short: [0.95, 1.35],
  bouncer: [1.42, 2.0],
};
export const LINES = {
  wide: [0.38, 0.6],
  off: [0.12, 0.3],
  stumps: [-0.1, 0.1],
  pads: [-0.34, -0.14],
};
export const LINE_NAMES = { wide: 'wide outside off', off: 'off stump', stumps: 'on the stumps', pads: 'on the pads' };
export const LENGTH_NAMES = { yorker: 'yorker', full: 'full', good: 'good length', short: 'short of a length', bouncer: 'bouncer' };

/** Batter's contact planes: where the ball meets the bat, front or back foot. */
export const CONTACT_X = { front: -7.12, back: -7.55, sweep: -7.2 };

/** Pad zones by footwork (world x/z boxes, height limit). */
export const PADS = {
  stance: { x: [-8.0, -7.45], z: [-0.34, 0.0], h: 0.62 },
  front: { x: [-7.5, -7.05], z: [-0.26, 0.08], h: 0.62 },
  back: { x: [-8.1, -7.6], z: [-0.22, 0.1], h: 0.62 },
  // Down on one knee for the sweeps: the front pad is low, out in front and in line.
  sweep: { x: [-7.6, -7.0], z: [-0.3, 0.14], h: 0.55 },
};

const STUMP_HALF = 0.114 + 0.03 + BALL_REAL_R;
const STUMP_TOP = 0.711 + 0.03 + BALL_REAL_R;

function lin(t0, p, v, a = { x: 0, y: -G, z: 0 }) {
  return (t) => {
    const u = t - t0;
    return { x: p.x + v.x * u + 0.5 * a.x * u * u, y: p.y + v.y * u + 0.5 * a.y * u * u, z: p.z + v.z * u + 0.5 * a.z * u * u };
  };
}

/**
 * spec: { type, kph, length, lenM, line, lineZ, hStumps, swing, seam }
 * paceK scales real speed (the diorama runs ~15% slow so the ball reads).
 * Returns a delivery with pos(t) for t >= 0 seconds after release.
 */
export function buildDelivery(spec, paceK = 0.8, rel = RELEASE_PT) {
  const v = (spec.kph / 3.6) * paceK;
  const xb = STUMPS_X + spec.lenM;
  const zs = spec.lineZ;
  const zb = zs - spec.seam;
  const bounce = { x: xb, y: BALL_R, z: zb };

  // Pre-bounce: horizontal speed ~ v, lateral swing as a constant acceleration
  // whose drift relative to the release tangent is `swing` metres at the bounce.
  const dx1 = rel.x - xb;
  const T1 = dx1 / (v * 0.985);
  const az = (2 * spec.swing) / (T1 * T1);
  const a1 = { x: 0, y: -G, z: az };
  const v1 = {
    x: (bounce.x - rel.x) / T1,
    y: (bounce.y - rel.y + 0.5 * G * T1 * T1) / T1,
    z: (bounce.z - rel.z - 0.5 * az * T1 * T1) / T1,
  };
  const f1 = lin(0, rel, v1, a1);

  // Post-bounce: the pitch takes ~10% of the pace; seam is the line change.
  const vx2 = v1.x * 0.9;
  const T2 = (xb - STUMPS_X) / -vx2;
  const hS = spec.hStumps + (BALL_R - BALL_REAL_R);
  const v2 = { x: vx2, y: (hS - BALL_R + 0.5 * G * T2 * T2) / T2, z: (zs - zb) / T2 };
  const f2 = lin(T1, bounce, v2);

  // Second bounce, if it comes down before the keeper.
  const vyAtGround = (() => {
    // time after T1 when y returns to BALL_R
    const tt = (2 * v2.y) / G;
    return tt;
  })();
  const T3 = T1 + vyAtGround;
  const p3 = f2(T3);
  const v3 = { x: v2.x * 0.85, y: v2.y * 0.45, z: v2.z };
  const f3 = lin(T3, { ...p3, y: BALL_R }, v3);

  const segs = [
    [0, T1, f1],
    [T1, T3, f2],
    [T3, Infinity, f3],
  ];
  const pos = (t) => {
    for (const [a, b, f] of segs) if (t < b) return f(Math.max(a, t));
    return f3(t);
  };
  // Horizontal x is linear inside each segment, so crossing times solve directly.
  const xVel = (t) => (t < T1 ? v1.x : t < T3 ? v2.x : v3.x);
  const timeAtX = (x) => {
    for (const [a, b, f] of segs) {
      const pa = f(a);
      const vx = xVel(a + 1e-6);
      const t = a + (x - pa.x) / vx;
      if (t >= a - 1e-9 && t <= b) return t;
    }
    return Infinity;
  };

  const tStumps = timeAtX(STUMPS_X);
  const atStumps = pos(tStumps);
  const realY = (p) => p.y - (BALL_R - BALL_REAL_R);
  const hitsStumps = Math.abs(atStumps.z) < STUMP_HALF && realY(atStumps) < STUMP_TOP;

  /** Where (if anywhere) the ball meets the pads for a given footwork. */
  function padImpact(foot) {
    const pad = PADS[foot];
    for (let x = pad.x[1]; x >= pad.x[0]; x -= 0.02) {
      const t = timeAtX(x);
      const p = pos(t);
      if (p.z > pad.z[0] - BALL_REAL_R && p.z < pad.z[1] + BALL_REAL_R && realY(p) < pad.h) return { t, p };
    }
    return null;
  }

  const tKeeper = timeAtX(KEEPER_HOME.x + 0.6);
  return {
    spec,
    speed: v,
    T1,
    bounce,
    pos,
    timeAtX,
    tStumps,
    atStumps,
    hitsStumps,
    padImpact,
    tKeeper,
    atKeeper: pos(tKeeper),
    contactTime: (foot) => timeAtX(CONTACT_X[foot]),
    contactPos: (foot) => pos(timeAtX(CONTACT_X[foot])),
    /** Lateral movement away from the right-hander (+) or into him (-). */
    movement: spec.swing + spec.seam,
    pitchedOutsideLeg: zb < -STUMP_HALF,
    isWide: zs > 0.9 || zs < -0.72 || spec.hStumps > 2.25,
  };
}

/** Length key for an actual bounce distance (the AI aims, it does not always hit). */
export function lengthOf(lenM) {
  if (lenM < 1.8) return 'yorker';
  if (lenM < 4.1) return 'full';
  if (lenM < 6.7) return 'good';
  if (lenM < 9.1) return 'short';
  return 'bouncer';
}
export function lineOf(z) {
  if (z > 0.34) return 'wide';
  if (z > 0.11) return 'off';
  if (z > -0.12) return 'stumps';
  return 'pads';
}
