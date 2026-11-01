import { LENGTHS, HEIGHTS, LINES, lengthOf, lineOf } from './delivery.js';
import { GAME } from './rules.js';
import { NEUTRAL } from './conditions.js';

/**
 * The AI captain and bowler. It sets the target, picks a plan and a field per
 * over, and chooses every delivery: type, pace, line and length. It is not
 * omniscient; it reads the match (required rate, wickets, the last ball) and
 * remembers where you have scored, and it misses its spot a little.
 */
export const TYPES = {
  outswinger: { name: 'Outswinger', kph: [132, 146], swing: [0.16, 0.32], seam: [0.0, 0.04] },
  inswinger: { name: 'Inswinger', kph: [130, 144], swing: [-0.3, -0.15], seam: [-0.04, 0.0] },
  offcutter: { name: 'Off-cutter', kph: [122, 134], swing: [-0.04, 0.03], seam: [-0.2, -0.1] },
  legcutter: { name: 'Leg-cutter', kph: [122, 134], swing: [-0.03, 0.04], seam: [0.1, 0.2] },
  bouncer: { name: 'Bouncer', kph: [140, 151], swing: [-0.05, 0.06], seam: [-0.03, 0.03], length: 'bouncer' },
  yorker: { name: 'Yorker', kph: [138, 149], swing: [-0.14, 0.04], seam: [0, 0], length: 'yorker' },
  slower: { name: 'Slower ball', kph: [104, 117], swing: [-0.04, 0.04], seam: [-0.06, 0.06] },
  // Holds its line: no swing, no seam. After a few that move, it is the one that beats the bat.
  straight: { name: 'Straight ball', kph: [134, 145], swing: [-0.03, 0.03], seam: [-0.02, 0.02] },
  // Spin (right-arm): swing is the drift in the air, seam the turn off the
  // pitch (+ away from the right-hander), keep how much pace it keeps (grip
  // or skid), h a change to the height at the stumps (dip and bounce).
  offbreak: { name: 'Off-break', style: 'off', kph: [82, 92], swing: [0.02, 0.07], seam: [-0.5, -0.25], keep: 0.84 },
  armball: { name: 'Arm ball', style: 'off', kph: [92, 100], swing: [0.06, 0.13], seam: [-0.03, 0.02], keep: 0.95, h: -0.06 },
  carrom: { name: 'Carrom ball', style: 'off', kph: [84, 92], swing: [-0.02, 0.03], seam: [0.2, 0.35], keep: 0.88 },
  quicker: { name: 'Quicker one', style: 'off', kph: [98, 106], swing: [0, 0.04], seam: [-0.12, -0.04], keep: 0.95, h: -0.1 },
  legbreak: { name: 'Leg-break', style: 'leg', kph: [78, 90], swing: [-0.07, -0.02], seam: [0.3, 0.6], keep: 0.84 },
  googly: { name: 'Googly', style: 'leg', kph: [78, 88], swing: [-0.05, 0], seam: [-0.45, -0.25], keep: 0.86 },
  topspinner: { name: 'Top-spinner', style: 'leg', kph: [78, 88], swing: [-0.03, 0.02], seam: [-0.04, 0.04], keep: 0.88, h: 0.18 },
  flipper: { name: 'Flipper', style: 'leg', kph: [90, 100], swing: [-0.02, 0.02], seam: [-0.03, 0.03], keep: 0.97, h: -0.2, fuller: 0.6 },
};
/** Spin types by the bowler's style. */
export const SPIN_TYPES = { off: ['offbreak', 'armball', 'carrom', 'quicker'], leg: ['legbreak', 'googly', 'topspinner', 'flipper'] };
export const isSpin = (type) => !!TYPES[type]?.style;
export const STYLE_NAMES = { pace: 'Pace', off: 'Off-spin', leg: 'Leg-spin' };

/** What a disguised ball is made to look like at the top of the run-up. */
export const DISGUISE = { slower: 'outswinger', offcutter: 'inswinger', legcutter: 'outswinger', inswinger: 'outswinger', outswinger: 'inswinger', googly: 'legbreak', flipper: 'legbreak', topspinner: 'legbreak', legbreak: 'googly', carrom: 'offbreak', armball: 'offbreak', quicker: 'offbreak', offbreak: 'carrom' };

export const PLANS = {
  newBall: { name: 'New ball: full and swinging', field: 'attack', types: { outswinger: 4, inswinger: 2.2, legcutter: 0.8, offcutter: 0.6, bouncer: 0.7, yorker: 0.4, slower: 0.3, straight: 0.8 }, lengths: { full: 2.2, good: 3, short: 0.8 } },
  channel: { name: 'Outside off, make him reach', field: 'balanced', types: { outswinger: 2.5, legcutter: 2, offcutter: 1, inswinger: 0.8, bouncer: 0.8, slower: 0.8, yorker: 0.4, straight: 1.0 }, lengths: { full: 1.2, good: 3, short: 1.4 } },
  shortBall: { name: 'Short-ball barrage', field: 'balanced', types: { bouncer: 3, offcutter: 1, legcutter: 1, outswinger: 0.8, slower: 0.8, yorker: 0.6, straight: 0.5 }, lengths: { good: 1, short: 3 } },
  stumps: { name: 'Attack the stumps', field: 'attack', types: { inswinger: 3, offcutter: 2, yorker: 1.5, outswinger: 1, slower: 0.8, bouncer: 0.5, straight: 2.2 }, lengths: { full: 2.5, good: 2.5, short: 0.5 } },
  death: { name: 'Death: yorkers and change-ups', field: 'death', types: { yorker: 3.4, slower: 2.2, bouncer: 1.2, offcutter: 1.2, legcutter: 0.8, outswinger: 0.5, straight: 0.6 }, lengths: { full: 1.5, good: 1.5, short: 1.2 } },
};

/**
 * Spinners' overs: tossed up to turn it, flat darts at the stumps to keep it
 * tight, or flat and wide at the death. Types are weights per style.
 */
export const SPIN_PLANS = {
  flight: { name: 'Flight it and turn it', field: 'spinAttack', types: { off: { offbreak: 4, carrom: 1, armball: 1, quicker: 0.6 }, leg: { legbreak: 4, googly: 1.5, topspinner: 1, flipper: 0.5 } }, lengths: { full: 1.8, good: 3, short: 0.35 } },
  darts: { name: 'Darts at the stumps', field: 'spinSave', types: { off: { offbreak: 2.5, quicker: 2, armball: 1.5, carrom: 0.6 }, leg: { legbreak: 2.5, flipper: 1.6, googly: 1.2, topspinner: 1 } }, lengths: { full: 1.2, good: 3.2, short: 0.3 } },
  deathSpin: { name: 'Flat and quick, wide of off', field: 'death', types: { off: { quicker: 3, carrom: 1.5, armball: 1.5, offbreak: 1 }, leg: { flipper: 2.5, googly: 2, legbreak: 1.2, topspinner: 1 } }, lengths: { full: 2, good: 2.4, short: 0.3 } },
};

const LINE_W = {
  outswinger: { off: 3, stumps: 2.2, wide: 0.9, pads: 0.2 },
  inswinger: { stumps: 3, off: 1.6, pads: 0.8, wide: 0.1 },
  offcutter: { stumps: 2.4, off: 2.2, pads: 0.4, wide: 0.3 },
  legcutter: { off: 3, stumps: 2, wide: 0.8, pads: 0.2 },
  bouncer: { stumps: 2.5, off: 1.5, pads: 0.6, wide: 0.4 },
  yorker: { stumps: 3.5, off: 1.2, pads: 0.6, wide: 0.6 },
  slower: { stumps: 2, off: 2.4, wide: 0.6, pads: 0.3 },
  straight: { stumps: 3.5, off: 1.2, pads: 0.7, wide: 0.1 },
  // A spinner aims where it will end up: the turn takes it from where it pitches.
  offbreak: { stumps: 3, off: 2.4, pads: 0.4, wide: 0.3 },
  armball: { off: 2.5, stumps: 2.5, pads: 0.3, wide: 0.3 },
  carrom: { off: 2.6, stumps: 2, wide: 0.6, pads: 0.1 },
  quicker: { stumps: 3.2, off: 1.6, pads: 0.5, wide: 0.2 },
  legbreak: { off: 3, stumps: 2.2, wide: 0.8, pads: 0.15 },
  googly: { stumps: 3, off: 1.8, pads: 0.5, wide: 0.1 },
  topspinner: { stumps: 2.6, off: 2.2, pads: 0.3, wide: 0.2 },
  flipper: { stumps: 3.5, off: 1.2, pads: 0.4, wide: 0.1 },
};

/**
 * The AI's target for a chase of `overs` (the difficulty's range is for five).
 * Longer games score a little slower per over but have twice the wickets.
 */
export function setTarget(diff, rng, overs = 5) {
  const k = overs / 5 * (TARGET_SCALE[overs] ?? 1);
  return Math.round(rng.int(diff.target[0], diff.target[1]) * k);
}
export const TARGET_SCALE = { 5: 1, 10: 1, 20: 0.9 };

/** Over plan from the match state (required rate, wickets in hand, overs left). */
export function planOver(m, memory, rng) {
  const overs = m.overs ?? GAME.overs;
  const over = Math.floor(m.balls / GAME.ballsPerOver);
  const left = overs - over;
  // Setting a total there is no rate to chase: bowl to a par of about nine an over.
  const need = m.target == null ? 9 * left : m.target - m.runs;
  const rr = need / Math.max(1, (overs * GAME.ballsPerOver - m.balls) / 6);
  // The new ball for the first fifth of the innings, the death for the last.
  const phase = Math.max(1, Math.round(overs * 0.2));
  if (m.style && m.style !== 'pace') return planSpin(m, rng, { rr, left, phase });
  let w;
  if (m.superOver) w = { death: 4, stumps: 0.6 };
  else if (over === 0) w = { newBall: 4, stumps: 1, channel: 0.6 };
  else if (left <= phase && left === 1) w = { death: 4, shortBall: 0.8, stumps: 0.6 };
  else if (left <= phase) w = { death: 3, shortBall: 1, stumps: 0.8, channel: 0.6 };
  else w = { channel: 2, shortBall: 1.1, stumps: 1.4, death: rr > 11 ? 2 : 0.4, newBall: over < phase ? 2.4 : over === 1 ? 1.4 : 0.2 };
  // A struggling batter gets attacked, a flying one gets the boundary riders.
  if (rr < 7) { w.stumps = (w.stumps ?? 0) + 1.5; w.newBall = (w.newBall ?? 0) + 0.6; }
  if (rr > 13) w.death = (w.death ?? 0) + 2.5;
  if (memory.shortRuns > 8) w.shortBall = (w.shortBall ?? 0) * 0.3;
  const key = rng.weighted(w);
  const plan = PLANS[key];
  // The field follows the plan but the captain defends when they need a lot.
  let field = plan.field;
  if (rr > 12 && field === 'attack') field = 'balanced';
  if (rr < 6 && field === 'death') field = 'balanced';
  // Over or round the wicket for the over: round to angle in at the stumps and
  // the body (the short-ball and stumps plans), now and then to change the angle.
  const roundP = { newBall: 0.1, channel: 0.15, shortBall: 0.45, stumps: 0.35, death: 0.25 }[key] ?? 0.15;
  const side = rng() < roundP ? 'round' : 'over';
  return { key, name: plan.name, field, side };
}

/** A spinner's over: flight when the batter is struggling, darts when he is going, flat at the death. */
function planSpin(m, rng, { rr, left, phase }) {
  const w = { flight: 2.6, darts: 1.8, deathSpin: 0.1 };
  if (left <= phase) Object.assign(w, { deathSpin: 3, darts: 1.5, flight: 0.4 });
  if (rr < 7) w.flight += 1.5;
  if (rr > 11) { w.darts += 1.5; w.deathSpin += 1; }
  const key = rng.weighted(w);
  const plan = SPIN_PLANS[key];
  let field = plan.field;
  if (rr > 12 && field === 'spinAttack') field = 'spinSave';
  // Off-spin goes round the wicket to the right-hander now and then (the angle away, then the turn back in).
  const side = rng() < (m.style === 'off' ? 0.3 : 0.1) ? 'round' : 'over';
  return { key, name: plan.name, field, side, style: m.style, types: plan.types[m.style] };
}

export function newMemory() {
  return { zone: {}, lastBall: null, ballsToBatter: 0, shortRuns: 0 };
}
/** After each ball: what the batter did with what. */
export function remember(memory, spec, runs, out) {
  const k = `${spec.length}:${spec.line}`;
  const z = (memory.zone[k] ??= { balls: 0, runs: 0, outs: 0 });
  z.balls++;
  z.runs += runs;
  if (out) z.outs++;
  if (spec.length === 'short' || spec.length === 'bouncer') memory.shortRuns += runs;
  memory.lastBall = { spec, runs, out };
  memory.ballsToBatter = out ? 0 : memory.ballsToBatter + 1;
}

export function chooseDelivery(m, plan, memory, rng) {
  const P = PLANS[plan.key] ?? SPIN_PLANS[plan.key];
  const spin = !!plan.style && plan.style !== 'pace';
  if (spin) return chooseSpin(m, plan, P, memory, rng);
  const tw = { ...P.types };
  const last = memory.lastBall;
  if (last && last.runs >= 4) {
    tw.bouncer = (tw.bouncer ?? 0) + 1.6;
    tw.slower = (tw.slower ?? 0) + 1.0;
  }
  if (last && last.spec.type === 'bouncer') tw.bouncer = (tw.bouncer ?? 0) * 0.4; // rarely two in a row
  if (memory.ballsToBatter < 2) {
    tw.outswinger = (tw.outswinger ?? 0) + 2.5;
    tw.bouncer = (tw.bouncer ?? 0) * 0.5;
  }
  // Bowl to the conditions: swing under cloud, cutters and bouncers off a helpful pitch.
  const C = m.cond ?? NEUTRAL;
  for (const k of ['outswinger', 'inswinger']) if (tw[k]) tw[k] *= C.swing ** 0.8;
  for (const k of ['offcutter', 'legcutter']) if (tw[k]) tw[k] *= C.seam ** 0.7;
  if (tw.bouncer) tw.bouncer *= C.bounce ** 3;
  const type = rng.weighted(tw);
  const T = TYPES[type];

  let length = T.length;
  if (!length) {
    const lw = { ...P.lengths };
    if (type === 'slower') { lw.full = (lw.full ?? 0) + 1; lw.short = (lw.short ?? 0) * 0.5; }
    // Avoid lengths that have been going for runs.
    for (const L of Object.keys(lw)) {
      let rpb = 0, n = 0;
      for (const ln of Object.keys(LINES)) {
        const z = memory.zone[`${L}:${ln}`];
        if (z) { rpb += z.runs; n += z.balls; }
      }
      if (n >= 2) lw[L] *= Math.max(0.35, 1.3 - (rpb / n) / 3);
    }
    length = rng.weighted(lw);
  }
  const lineW = { ...LINE_W[type] };
  for (const ln of Object.keys(lineW)) {
    const z = memory.zone[`${length}:${ln}`];
    if (z && z.balls >= 2) lineW[ln] *= Math.max(0.3, 1.25 - (z.runs / z.balls) / 3.5) + z.outs * 0.6;
  }
  const line = rng.weighted(lineW);

  // Execution: aim at the middle of the zone, scatter around it.
  const aimLen = rng.range(...LENGTHS[length]);
  const aimLine = rng.range(...LINES[line]);
  const scatter = type === 'yorker' ? 0.55 : 0.35;
  let lenM = Math.max(0.35, aimLen + (rng() - 0.5) * 2 * scatter);
  let lineZ = aimLine + (rng() - 0.5) * 0.12;
  // A stray one now and then: down the leg side or a wide.
  if (rng() < 0.035) lineZ = rng() < 0.5 ? rng.range(0.92, 1.05) : rng.range(-0.85, -0.74);
  const actualLen = lengthOf(lenM);
  // The sky scales the swing and a cross-wind pushes the ball along (toward off
  // is away from the right-hander, like outswing); the pitch scales the seam.
  // The over's angle, with the odd ball from the other side of the stumps.
  const side = rng() < 0.05 ? (plan.side === 'round' ? 'over' : 'round') : plan.side ?? 'over';
  const swing = rng.range(...T.swing) * C.swing + C.wind.z * 0.012;
  const seam = rng.range(...T.seam) * C.seam;
  // Bowling into the wind costs a little pace, with it adds a little.
  const kph = Math.round(rng.range(...T.kph) * (1 - C.wind.x * 0.004));
  // Height follows where in its band it pitched (shorter = higher), and the
  // pitch adds its own: now and then one keeps low or climbs. Cutters vary more.
  const band = LENGTHS[actualLen];
  const u = Math.min(1, Math.max(0, (lenM - band[0]) / (band[1] - band[0])));
  const [h0, h1] = HEIGHTS[actualLen];
  const pv = (rng() + rng() - 1) * (type === 'offcutter' || type === 'legcutter' ? 0.17 : 0.12);
  let pitchVar = pv * C.uneven;
  // An uneven surface throws up the odd shooter or one that rears.
  if (C.uneven > 1 && rng() < 0.05 * (C.uneven - 1)) pitchVar += rng() < 0.6 ? -0.22 : 0.25;
  // What the surface did beyond an even pitch: the batter can't allow for it.
  const surprise = pitchVar - pv;
  const h = h0 + (h1 - h0) * (0.15 + 0.7 * u) + pitchVar + (type === 'slower' ? -0.05 : 0);
  // A bouncy pitch lifts everything that isn't skidding through at the feet.
  const hStumps = Math.max(0.05, 0.1 + (h - 0.1) * C.bounce);
  return {
    type,
    typeName: T.name,
    kph,
    length: actualLen,
    aimed: length,
    aimedLine: line,
    aimLenM: aimLen,
    aimLineZ: aimLine,
    lenM,
    line: lineOf(lineZ),
    lineZ,
    hStumps,
    swing,
    seam,
    keep: C.keep,
    side,
    surprise,
  };
}

/**
 * A spinner's ball: the type for the plan (a dart after he has been hit, the
 * stock ball to a new batter), a fuller length, a line, and the turn, which a
 * dry pitch adds to. Same spec shape as the seamers'.
 */
function chooseSpin(m, plan, P, memory, rng) {
  const C = m.cond ?? NEUTRAL;
  const tw = { ...plan.types };
  const last = memory.lastBall;
  const stock = plan.style === 'off' ? 'offbreak' : 'legbreak';
  const dart = plan.style === 'off' ? 'quicker' : 'flipper';
  if (last && last.runs >= 4) tw[dart] = (tw[dart] ?? 0) + 1.4;
  if (memory.ballsToBatter < 2) tw[stock] = (tw[stock] ?? 0) + 2;
  const type = rng.weighted(tw);
  const T = TYPES[type];
  const lw = { ...P.lengths };
  for (const L of Object.keys(lw)) {
    let rpb = 0, n = 0;
    for (const ln of Object.keys(LINES)) {
      const z = memory.zone[`${L}:${ln}`];
      if (z) { rpb += z.runs; n += z.balls; }
    }
    if (n >= 2) lw[L] *= Math.max(0.35, 1.3 - (rpb / n) / 3);
  }
  const length = rng.weighted(lw);
  const lineW = { ...LINE_W[type] };
  for (const ln of Object.keys(lineW)) {
    const z = memory.zone[`${length}:${ln}`];
    if (z && z.balls >= 2) lineW[ln] *= Math.max(0.3, 1.25 - (z.runs / z.balls) / 3.5) + z.outs * 0.6;
  }
  const line = rng.weighted(lineW);
  // A spinner's good length is fuller than a seamer's; the flipper fuller still.
  const band = LENGTHS[length];
  const aimLen = rng.range(...band) - (length === 'good' ? 0.6 : 0) - (T.fuller ?? 0);
  const aimLine = rng.range(...LINES[line]);
  let lenM = Math.max(0.9, aimLen + (rng() - 0.5) * 2 * 0.3);
  let lineZ = aimLine + (rng() - 0.5) * 0.1;
  if (rng() < 0.02) lineZ = rng() < 0.5 ? rng.range(0.92, 1.0) : rng.range(-0.8, -0.74);
  const actualLen = lengthOf(lenM);
  const side = rng() < 0.05 ? (plan.side === 'round' ? 'over' : 'round') : plan.side ?? 'over';
  const turn = C.turn ?? 1;
  const swing = rng.range(...T.swing) + C.wind.z * 0.02; // slower through the air: the wind moves it more
  const seam = rng.range(...T.seam) * (Math.abs(T.seam[0]) > 0.1 ? turn : 1);
  const kph = Math.round(rng.range(...T.kph) * (1 - C.wind.x * 0.004));
  const b2 = LENGTHS[actualLen];
  const u = Math.min(1, Math.max(0, (lenM - b2[0]) / (b2[1] - b2[0])));
  const [h0, h1] = HEIGHTS[actualLen];
  const pv = (rng() + rng() - 1) * 0.1;
  let pitchVar = pv * C.uneven;
  if (C.uneven > 1 && rng() < 0.05 * (C.uneven - 1)) pitchVar += rng() < 0.6 ? -0.2 : 0.22;
  const surprise = pitchVar - pv;
  const h = h0 + (h1 - h0) * (0.15 + 0.7 * u) + pitchVar + (T.h ?? 0);
  const hStumps = Math.max(0.05, 0.1 + (h - 0.1) * C.bounce);
  return {
    type,
    typeName: T.name,
    style: plan.style,
    spin: true,
    kph,
    length: actualLen,
    aimed: length,
    aimedLine: line,
    aimLenM: aimLen,
    aimLineZ: aimLine,
    lenM,
    line: lineOf(lineZ),
    lineZ,
    hStumps,
    swing,
    seam,
    // A turning pitch grips the slow ball more; the skidders keep their pace.
    keep: Math.min(0.98, T.keep * (C.keep / 0.9) ** 0.5),
    side,
    surprise,
  };
}
