import { lengthOf, lineOf, CONTACT_X } from './delivery.js';
import { BALL_REAL_R } from './rules.js';

/**
 * Shots and the outcome model. A shot is chosen by the arrows held when D
 * (ground) or A (lofted) is pressed:
 *
 *        ↑← late cut     ↑ back-foot punch     ↑→ leg glance
 *        ←  square cut   (D alone) defence     →  pull / hook
 *        ↓← cover drive  ↓ straight drive      ↓→ on drive
 *
 * Off side is screen-left from behind the bowler. `az` is the aimed direction
 * (radians from +X toward +Z); `arc` is how far either side of it the batter
 * can place the ball (a well-timed, well-chosen shot finds the gap in it). `len` and `line` say which balls the shot is
 * for; `fit` (0..1) is how well this ball suits it. Timing error is
 *   err = press + swing - contact   (seconds; < 0 early, > 0 late)
 */
const D = Math.PI / 180;
export const SHOTS = {
  straight: { name: 'Straight drive', az: 0 * D, arc: 14 * D, foot: 'front', swing: 0.13, power: 1.0, len: { yorker: 0.55, full: 1, good: 0.55, short: 0.1, bouncer: 0 }, line: [-0.14, 0.2] },
  cover: { name: 'Cover drive', az: 40 * D, arc: 24 * D, foot: 'front', swing: 0.13, power: 1.0, len: { yorker: 0.3, full: 1, good: 0.65, short: 0.12, bouncer: 0 }, line: [0.1, 0.6] },
  cut: { name: 'Square cut', az: 88 * D, arc: 24 * D, foot: 'back', swing: 0.12, power: 1.08, drift: 0.6, len: { yorker: 0, full: 0.12, good: 0.55, short: 1, bouncer: 0.5 }, line: [0.24, 0.8] },
  lateCut: { name: 'Late cut (third-man guide)', az: 158 * D, arc: 20 * D, foot: 'back', swing: 0.09, power: 0.42, paceUse: 0.32, bias: 0.035, drift: 0.8, len: { yorker: 0, full: 0.1, good: 0.7, short: 0.95, bouncer: 0.3 }, line: [0.14, 0.75] },
  punch: { name: 'Back-foot punch', az: 18 * D, arc: 20 * D, foot: 'back', swing: 0.11, power: 0.62, len: { yorker: 0.05, full: 0.3, good: 0.9, short: 0.9, bouncer: 0.15 }, line: [-0.12, 0.36] },
  glance: { name: 'Leg glance', az: -140 * D, arc: 20 * D, foot: 'front', swing: 0.1, power: 0.55, paceUse: 0.15, bias: 0.02, drift: 1.2, len: { yorker: 0.35, full: 0.85, good: 0.9, short: 0.45, bouncer: 0.1 }, line: [-0.42, -0.02] },
  pull: { name: 'Pull', az: -88 * D, arc: 28 * D, foot: 'back', swing: 0.12, power: 1.12, drift: 0.6, len: { yorker: 0, full: 0.04, good: 0.35, short: 1, bouncer: 0.9 }, line: [-0.45, 0.36] },
  // The pull key's other half: to a full or good-length ball the batter flicks it off the pads.
  flick: { name: 'Flick', az: -62 * D, arc: 22 * D, foot: 'front', swing: 0.1, power: 0.7, paceUse: 0.18, drift: 1.1, len: { yorker: 0.4, full: 0.95, good: 0.7, short: 0.2, bouncer: 0 }, line: [-0.42, -0.04] },
  onDrive: { name: 'On drive', az: -32 * D, arc: 22 * D, foot: 'front', swing: 0.13, power: 0.95, len: { yorker: 0.5, full: 1, good: 0.55, short: 0.1, bouncer: 0 }, line: [-0.32, 0.08] },
  // S + arrows: the specials. Down on one knee; tighter timing (window x).
  sweep: { name: 'Sweep', az: -100 * D, arc: 28 * D, foot: 'sweep', special: true, swing: 0.15, power: 0.85, window: 0.7, drift: 1.4, len: { yorker: 0.2, full: 0.9, good: 0.85, short: 0.12, bouncer: 0 }, line: [-0.42, 0.14] },
  reverseSweep: { name: 'Reverse sweep', az: 112 * D, arc: 24 * D, foot: 'sweep', special: true, swing: 0.15, power: 0.8, window: 0.6, drift: 1.4, len: { yorker: 0.1, full: 0.85, good: 0.85, short: 0.1, bouncer: 0 }, line: [-0.06, 0.6] },
  scoop: { name: 'Scoop', az: 177 * D, arc: 14 * D, foot: 'sweep', special: true, swing: 0.13, power: 0.5, paceUse: 0.45, window: 0.55, drift: 1.6, len: { yorker: 0.6, full: 0.9, good: 0.55, short: 0.1, bouncer: 0 }, line: [-0.16, 0.2] },
  defence: { name: 'Defence', az: 6 * D, arc: 0 * D, foot: 'auto', swing: 0.1, power: 0.22, len: { yorker: 0.85, full: 0.95, good: 1, short: 0.85, bouncer: 0.3 }, line: [-0.4, 0.5] },
};
/**
 * Outcome-model coefficients. Tunable (src/game/tuning.js): read at use, so a
 * calibration applied at runtime takes effect on the next ball.
 */
export const K = {
  missCoef: 0.8, // poor fit -> play and miss
  missTimingRelief: 0.4, // good timing saves some of a poor fit
  missMove: 0.25, // movement (swing + seam, m) -> miss
  missFloor: 0.05,
  wrongShotFit: 0.1, // below this fit the shot is the wrong shape entirely
  wrongShotMiss: 0.85,
  edgeBase: 0.02,
  edgeFit: 0.4, // poor fit -> edge
  edgeMove: 0.35,
  spinMove: 0.45, // how much of a spinner's turn plays like seam movement (he sees it coming)
  spinPower: 3.0, // m/s more off a clean hit against spin
  place: 0.8, // how far a perfectly timed, well-chosen shot is steered into the gap (0 = never)
  placeFrom: 0.8, // contact quality (timing x fit) below which there is no placing at all (only a near-perfect, well-chosen shot finds the gap)
  angleAway: 0.12, // angle across the right-hander (round the wicket to off), per m beyond 0.3 m -> extra movement
  edgeTiming: 0.25, // poor timing -> edge
  defenceEdge: 0.55, // the dead bat edges less
  loftEdge: 0.05,
  drift: 5.5, // rad per second of timing error (early -> leg side)
  groundBase: 9,
  groundQ: 15,
  loftBase: 7,
  loftQ: 11.5,
  spread: 0.16, // rad: scatter round the aimed line (more for mistimed and quicker balls)
  specialMiss: 0.35, // sweeps and scoops: mistiming -> miss
  specialEdge: 1.6, // sweeps and scoops: edge multiplier
};
export const SHOT_KEYS = { D: 'straight', DL: 'cover', L: 'cut', UL: 'lateCut', U: 'punch', UR: 'glance', R: 'pull', DR: 'onDrive', '': 'defence' };
/** S + arrows: S alone / any right or down = sweep, any left = reverse sweep, up = scoop. */
/** Balls pitching nearer than this to the stumps (m) are flicked on the pull key; longer ones pulled. */
export const FLICK_MAX_LEN = 6.0;

/** The shot a key press means for this ball: → is a flick to a fuller ball, a pull to a short one. */
export function shotFor(dirKey, special, del) {
  if (special) return SPECIAL_KEYS[dirKey] ?? 'sweep';
  const k = SHOT_KEYS[dirKey] ?? 'defence';
  if (k === 'pull' && del && del.spec.lenM < FLICK_MAX_LEN) return 'flick';
  return k;
}
export const SPECIAL_KEYS = { '': 'sweep', R: 'sweep', DR: 'sweep', UR: 'sweep', D: 'sweep', L: 'reverseSweep', DL: 'reverseSweep', UL: 'reverseSweep', U: 'scoop' };

export function shotFoot(shot, del) {
  if (shot.foot !== 'auto') return shot.foot;
  return ['short', 'bouncer'].includes(lengthOf(del.spec.lenM)) ? 'back' : 'front';
}

function bandFit(z, [a, b], soft = 0.24) {
  if (z >= a && z <= b) return 1;
  const d = z < a ? a - z : z - b;
  return Math.max(0, 1 - d / soft);
}

/** How well this ball suits this shot, 0..1, using where it actually arrives. */
export function shotFit(shot, del, foot) {
  const len = lengthOf(del.spec.lenM);
  const p = del.contactPos(foot);
  let f = shot.len[len] * bandFit(p.z, shot.line);
  // Height at the bat: drives want it below the knee roll to waist, pulls want it high.
  const h = p.y;
  if (shot.foot === 'front' && h > 1.15) f *= 0.35;
  if (shot.special && h > 0.9) f *= 0.3; // a sweep or scoop needs the ball low
  if ((shot === SHOTS.pull) && h < 0.55) f *= 0.4;
  return f;
}

export function timingLabel(err, w) {
  const a = Math.abs(err);
  if (a <= w.perfect) return 'PERFECT';
  if (a <= w.sigma * 1.25) return err < 0 ? 'EARLY' : 'LATE';
  return err < 0 ? 'VERY EARLY' : 'VERY LATE';
}

/**
 * Resolve a played shot. Returns one of
 *   { kind: 'miss' }                                  beaten; laws check follows
 *   { kind: 'hit', az, speed, elev, edge, q, ... }    the ball comes off the bat
 *   { kind: 'playedOn' }                              inside edge onto the stumps
 * Every branch carries err, fit, foot, tContact and a short `call` for the HUD.
 */
export function resolveShot({ del, shotKey, lofted, pressT, diff, rng, field = null }) {
  const shot = SHOTS[shotKey];
  const foot = shotFoot(shot, del);
  const tC = del.contactTime(foot);
  const err = pressT + shot.swing - tC - (shot.bias ?? 0);
  const fit = shotFit(shot, del, foot);
  const wm = shot.window ?? 1;
  const w = wm === 1 ? diff.window : { perfect: diff.window.perfect * wm, sigma: diff.window.sigma * wm, miss: diff.window.miss * wm };
  const base = { shotKey, shot: shot.name, lofted, foot, err, fit, tContact: tC, timing: timingLabel(err, w) };
  const len = lengthOf(del.spec.lenM);
  const p = del.contactPos(foot);

  if (Math.abs(err) > w.miss || del.isWide && p.z > 0.85) return { ...base, kind: 'miss', call: 'Beaten' };
  // Way over the top of a short ball with a front-foot shot: through it, no contact.
  if (p.y > 1.7 && shot !== SHOTS.pull) return { ...base, kind: 'miss', call: 'Beaten by the bounce' };

  const tq = Math.exp(-((err / w.sigma) ** 2));
  // Movement in the air and off the seam, plus any bounce an uneven pitch adds.
  // A ball angled across him (round the wicket at off stump and wider) plays like a little more movement.
  // Spin: slower, so the turn is seen and played; only part of it counts (K.spinMove).
  const moved = del.spec?.spin ? Math.abs(del.spec.swing) + Math.abs(del.spec.seam) * K.spinMove : Math.abs(del.movement);
  const move = moved + 1.5 * Math.abs(del.spec?.surprise ?? 0) + K.angleAway * Math.max(0, (del.angle ?? 0) - 0.3);
  // A poor fit plays and misses as often as it edges; the wrong shape entirely
  // (a pull to a yorker, a drive to a bouncer) almost never meets it.
  let missP = Math.max(0, (1 - fit) ** 2 * K.missCoef * (1 - K.missTimingRelief * tq) + move * K.missMove - K.missFloor);
  if (fit < K.wrongShotFit) missP = Math.max(missP, K.wrongShotMiss);
  if (shot.special) missP += (1 - tq) * K.specialMiss; // the specials punish mistiming
  if (rng() < missP) return { ...base, kind: 'miss', call: fit < 0.4 ? 'Wrong shot, beaten' : 'Played and missed' };

  // Good timing covers most of a poor fit; bad timing finds the edge.
  let edgeP = (K.edgeBase + (1 - fit) * K.edgeFit + move * K.edgeMove) * (0.35 + 0.65 * (1 - tq)) + (1 - tq) * K.edgeTiming;
  if (shotKey === 'defence') edgeP *= K.defenceEdge;
  if (lofted) edgeP += K.loftEdge;
  if (shot.special) edgeP *= K.specialEdge;
  edgeP = Math.min(0.85, edgeP);

  if (rng() < edgeP) {
    const awayMove = del.movement > 0.04;
    const shortBall = len === 'short' || len === 'bouncer';
    let edge;
    if (shot.special) edge = rng() < 0.6 ? 'top' : err > 0 ? 'outside' : 'inside';
    else if (shortBall && (shotKey === 'pull' || shot.foot === 'front' || lofted)) edge = 'top';
    else if (err < -w.sigma && (shotKey === 'straight' || shotKey === 'cover' || shotKey === 'onDrive') && del.spec.seam < -0.04) edge = 'leading';
    else if (err > 0.01 || (awayMove && p.z > 0.02)) edge = 'outside';
    else edge = 'inside';
    if (edge === 'inside' && del.hitsStumps && rng() < 0.5) return { ...base, kind: 'playedOn', call: 'Chopped on' };
    return { ...base, ...edgeLaunch(edge, del, rng), kind: 'hit', edge, q: 0.1, call: { top: 'Top edge', leading: 'Leading edge', outside: 'Outside edge', inside: 'Inside edge' }[edge] };
  }

  // Clean contact.
  const q = tq * (0.3 + 0.7 * fit);
  // Direction: timing drags it (early -> leg side, late -> off side), more off a
  // quicker ball; and it scatters round the aim, more when mistimed.
  const paceF = del.speed / 28;
  const scatter = ((rng() + rng()) - 1) * K.spread * (0.8 + 0.9 * (1 - q)) * paceF;
  const driftAz = err * K.drift * (shot.drift ?? 1) * paceF;
  let az = shot.az + driftAz + scatter;
  // Placement: the better it is timed and the better the shot suits the ball,
  // the more it is steered into the biggest gap in the shot's arc.
  const placeK = K.place * Math.min(1, Math.max(0, (q - K.placeFrom) / (1 - K.placeFrom))) ** 0.8;
  let gapAz = null;
  if (field && shot.arc && placeK > 0) {
    gapAz = findGap(p, shot.az, shot.arc, field, lofted);
    az += (gapAz - az) * placeK;
  }
  // Glances, guides and scoops use the bowler's pace as much as the swing.
  // (Against spin there is little pace to use, but time to get into it and hit through: K.spinPower.)
  let speed = shot.power * (K.groundBase + K.groundQ * q) + (shot.paceUse ?? 0) * del.speed * q + (del.spec?.spin ? K.spinPower * q * shot.power : 0);
  let elev;
  if (shotKey === 'scoop') {
    // Up and over the keeper: always in the air.
    elev = (30 + rng() * 16) * D;
  } else if (lofted && shotKey !== 'defence') {
    speed = shot.power * (K.loftBase + K.loftQ * q);
    if (q > 0.55) {
      elev = (26 + rng() * 12) * D;
    } else {
      // Mistimed lofted shot: skied, or a flat one straight to a fielder.
      elev = (q < 0.3 ? 48 + rng() * 20 : 16 + rng() * 14) * D;
      speed *= 0.82;
    }
  } else {
    // Along the ground: from knee height it is down within a few metres.
    elev = (-3 + rng() * 4) * D;
    // Early on a front-foot shot to a fuller ball pops it up (uppish).
    if (err < -w.sigma * 0.8 && shot.foot === 'front') elev = (11 + rng() * 9) * D;
    // A pull is rolled down; only the lofted one (the hook) goes up.
    if (shotKey === 'pull') elev = (-7 + rng() * 5) * D;
    if (shotKey === 'defence') elev = (-4 + rng() * 4) * D;
    if (shotKey === 'lateCut') elev = (-5 + rng() * 4) * D; // guided down
  }
  // Calibrated launch angle per shot (feedback: "too flat / too high").
  elev += shot.elev ?? 0;
  const quality = q > 0.82 ? 'Middled' : q > 0.55 ? 'Well hit' : q > 0.3 ? 'Mistimed' : 'Off the inside half';
  const placed = gapAz != null && placeK > 0.3 && Math.abs(gapAz - shot.az) > 4 * D;
  return { ...base, kind: 'hit', edge: null, az, aimAz: shot.az, driftAz, scatter, gapAz, placeK, speed, elev, q, call: placed ? `${quality} · into the gap` : quality };
}

/**
 * The best direction within aim ± arc from the contact point p: the one whose
 * nearest fielder (by angle, less the angle he covers by reach and running)
 * is furthest away. Fielders behind the shot or right on top of the bat don't
 * count; a lofted shot cares about the deep men, a ground shot about everyone.
 */
export function findGap(p, aim, arc, field, lofted = false) {
  const men = [];
  for (const f of field) {
    const dx = f.x - p.x;
    const dz = f.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 3) continue;
    // What he covers: his reach at that distance, plus what he can run while the ball travels.
    const cover = Math.atan(1.0 / d) + 0.12 + (lofted && d < 14 ? -0.08 : 0);
    men.push({ az: Math.atan2(dz, dx), cover });
  }
  let best = aim;
  let bestScore = -Infinity;
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const a = aim - arc + (2 * arc * i) / n;
    let gap = Math.PI;
    for (const m of men) {
      const da = Math.abs(Math.atan2(Math.sin(a - m.az), Math.cos(a - m.az)));
      if (da > Math.PI / 2) continue;
      gap = Math.min(gap, da - m.cover);
    }
    // Past ~20 degrees clear it is simply open; then a gap near the aim beats one at the edge of the arc.
    const score = Math.min(gap, 0.35) - 0.15 * Math.abs(a - aim);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/**
 * Where edges go, per kind: direction (az, radians from straight toward the off
 * side) and its half-range, speed (× the ball's pace when `pace`, else m/s) and
 * its half-range, launch angle (radians) and its half-range. Tunable from the
 * nets feedback and the Edges tab. A top edge flies to either side (`mirror`:
 * az is its distance from straight).
 */
export const EDGES = {
  outside: { name: 'Outside edge', az: Math.PI - 0.395, azHalf: 0.275, flip: true, pace: true, speed: 0.43, speedHalf: 0.11, elev: 6.5 * D, elevHalf: 4.5 * D },
  inside: { name: 'Inside edge', az: -Math.PI + 0.45, azHalf: 0.3, pace: true, speed: 0.3, speedHalf: 0.1, elev: -1.5 * D, elevHalf: 4.5 * D },
  top: { name: 'Top edge', az: 1.7, azHalf: 1.1, mirror: true, pace: false, speed: 11, speedHalf: 3, elev: 64 * D, elevHalf: 9 * D },
  leading: { name: 'Leading edge', az: 62.5 * D, azHalf: 27.5 * D, pace: false, speed: 9.5, speedHalf: 2.5, elev: 27 * D, elevHalf: 9 * D },
};

function edgeLaunch(edge, del, rng) {
  const e = EDGES[edge] ?? EDGES.leading;
  const side = e.mirror ? (rng() < 0.5 ? -1 : 1) : 1;
  const ra = rng();
  const az = side * (e.az + e.azHalf * (e.flip ? 1 - 2 * ra : 2 * ra - 1));
  const sp = e.speed + e.speedHalf * (2 * rng() - 1);
  const elev = e.elev + e.elevHalf * (2 * rng() - 1);
  return { az, speed: e.pace ? del.speed * sp : sp, elev, edgeAim: side * e.az };
}

/**
 * The laws, when the bat never touches it (a miss or a leave).
 * Returns { out: 'bowled' | 'lbw' | null, pad: bool, call }.
 */
export function lawsCheck(del, foot) {
  const pad = del.padImpact(foot);
  if (pad) {
    const inLine = pad.p.z > -(0.114 + 0.03 + BALL_REAL_R);
    if (del.hitsStumps && inLine && !del.pitchedOutsideLeg) return { out: 'lbw', pad: true, call: 'LBW' };
    return { out: null, pad: true, call: del.pitchedOutsideLeg ? 'Pitched outside leg' : 'Hit on the pad' };
  }
  if (del.hitsStumps) return { out: 'bowled', pad: false, call: 'Bowled' };
  return { out: null, pad: false, call: null };
}

export { CONTACT_X, lineOf, lengthOf };
