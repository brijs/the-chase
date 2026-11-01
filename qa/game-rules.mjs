import { createMatch } from '../src/game/match.js';
import { SHOTS, shotFoot, shotFor, findGap, K } from '../src/game/batting.js';
import { buildDelivery, pitchZ } from '../src/game/delivery.js';
import { TYPES } from '../src/game/bowlerAI.js';
import { readFileSync } from 'node:fs';
import { tuning } from '../src/game/tuning.js';
import { simulateInnings } from '../src/game/aiInnings.js';
import { simulateBatted } from '../src/game/ballSim.js';
import { resolveConditions } from '../src/game/conditions.js';
import { trackLbw, lbwVerdict, decideLbw, decideEdgeCatch, decidePhantomEdge } from '../src/game/umpire.js';
import { makeRng, RELEASE_PT, RELEASE_ROUND } from '../src/game/rules.js';
import { fieldPositions } from '../src/game/fielding.js';

// CAL=calibration.json runs with a calibration applied (default: code defaults).
if (process.env.CAL) {
  tuning.apply(JSON.parse(readFileSync(process.env.CAL, 'utf8')).params);
  console.log(`using calibration ${process.env.CAL}: ${Object.keys(tuning.overrides()).length} values differ from defaults`);
}

/**
 * Rule checks for the Chase outcome model (Node, no browser). Each case bowls
 * the same forced delivery many times with a scripted input and checks the
 * share of outcomes. Exit code 1 if any check fails.
 *
 *   node qa/game-rules.mjs
 */
const N = 300;
const base = { kph: 138, swing: 0, seam: 0, hStumps: 0.45 };
function trial(force, input, difficulty = 'medium') {
  const tally = {};
  const azs = [];
  for (let i = 1; i <= N; i++) {
    const m = createMatch({ difficulty, seed: 1000 + i });
    m.startOver();
    const ball = m.nextDelivery({ ...base, ...force });
    let inp = null;
    if (input) {
      const sh = SHOTS[input.shot];
      const tC = ball.del.contactTime(shotFoot(sh, ball.del));
      inp = { shotKey: input.shot, lofted: !!input.lofted, pressT: tC - sh.swing + (sh.bias ?? 0) + (input.err ?? 0) };
      azs.push(null);
    }
    const o = m.resolve(ball, inp);
    if (o.kind === 'hit' && !o.shot.edge) azs[azs.length - 1] = (o.shot.az * 180) / Math.PI;
    const k = o.out ? o.out : o.shot?.edge ? `edge:${o.shot.edge}` : o.kind === 'miss' ? 'beaten' : o.runs >= 4 ? 'boundary' : o.kind === 'hit' ? 'hit' : 'safe';
    tally[k] = (tally[k] ?? 0) + 1;
  }
  const p = (k) => (Array.isArray(k) ? k : [k]).reduce((a, x) => a + (tally[x] ?? 0), 0) / N;
  const az = azs.filter((x) => x !== null);
  p.az = { mean: az.reduce((a, b) => a + b, 0) / Math.max(1, az.length), sd: Math.sqrt(az.reduce((a, b) => a + b * b, 0) / Math.max(1, az.length) - (az.reduce((a, b) => a + b, 0) / Math.max(1, az.length)) ** 2) };
  return p;
}

const FULL_OFF = { type: 'outswinger', lenM: 2.8, lineZ: 0.24, hStumps: 0.42, swing: 0.05 };
let cases = [
  ['perfect cover drive, full outside off -> mostly hit, often a boundary', trial(FULL_OFF, { shot: 'cover' }), (p) => p(['hit', 'boundary']) > 0.75 && p('boundary') > 0.25],
  ['perfect lofted cover drive -> boundaries (incl. sixes) > 35%', trial(FULL_OFF, { shot: 'cover', lofted: true }), (p) => p('boundary') > 0.35],
  ['leave, straight full ball on off/middle -> bowled or LBW every time', trial({ type: 'inswinger', lenM: 3.0, lineZ: 0.05, hStumps: 0.4, swing: -0.1 }, null), (p) => p(['bowled', 'lbw']) === 1],
  ['leave, wide outswinger -> safe', trial({ type: 'outswinger', lenM: 5.2, lineZ: 0.55, hStumps: 0.7, swing: 0.25 }, null), (p) => p('safe') === 1],
  ['late drive (+90 ms) at a big outswinger -> edges/misses > 45%', trial({ type: 'outswinger', lenM: 5.0, lineZ: 0.28, hStumps: 0.7, swing: 0.3 }, { shot: 'cover', err: 0.09 }), (p) => p(['edge:outside', 'edge:inside', 'beaten', 'caught']) > 0.45],
  ['perfect pull to a bouncer -> mostly middled', trial({ type: 'bouncer', lenM: 10.0, lineZ: 0.02, hStumps: 1.6 }, { shot: 'pull' }), (p) => p(['hit', 'boundary']) > 0.6],
  ['pull to a yorker on the stumps -> beaten/out/edged > 60%', trial({ type: 'yorker', lenM: 1.0, lineZ: 0.0, hStumps: 0.12 }, { shot: 'pull' }), (p) => p(['beaten', 'bowled', 'lbw', 'edge:inside', 'edge:outside', 'edge:top', 'caught']) > 0.6],
  ['way early (-200 ms) straight drive -> beaten', trial({ type: 'outswinger', lenM: 3.0, lineZ: 0.3, hStumps: 0.45 }, { shot: 'straight', err: -0.2 }), (p) => p(['beaten', 'bowled', 'lbw']) === 1],
  ['forward defence to good length on the stumps -> rarely out (< 12%)', trial({ type: 'outswinger', lenM: 5.3, lineZ: 0.05, hStumps: 0.7, swing: 0.15 }, { shot: 'defence' }), (p) => p(['bowled', 'lbw', 'caught']) < 0.12],
  ['perfect cover drives are placed inside the cover arc (16..64 deg)', trial(FULL_OFF, { shot: 'cover' }), (p) => p.az.mean > 16 && p.az.mean < 64 && p.az.sd < 12],
  ['early (-40 ms) cover drive is dragged leg-side of perfect', trial(FULL_OFF, { shot: 'cover', err: -0.04 }), (p) => p.az.mean < 32],
  ['perfect pull to a short ball stays in the pull arc (mean -116..-60 deg)', trial({ type: 'bouncer', lenM: 8.3, lineZ: 0.0, hStumps: 1.15 }, { shot: 'pull' }), (p) => p.az.mean > -116 && p.az.mean < -60],
  ['late cut guides to third man (mean 140..175 deg)', trial({ type: 'legcutter', lenM: 7.5, lineZ: 0.4, hStumps: 1.0, seam: 0.05 }, { shot: 'lateCut' }), (p) => p.az.mean > 140 && p.az.mean < 175],
  ['perfect sweep to a full ball at the pads -> mostly hit', trial({ type: 'offcutter', lenM: 3.4, lineZ: -0.15, hStumps: 0.45 }, { shot: 'sweep' }), (p) => p(['hit', 'boundary']) > 0.6],
  ['sweep 45 ms late at the stumps -> beaten/out/edged > 45% (tight window)', trial({ type: 'offcutter', lenM: 3.4, lineZ: 0.0, hStumps: 0.45 }, { shot: 'sweep', err: 0.045 }), (p) => p(['beaten', 'bowled', 'lbw', 'caught', 'edge:top', 'edge:inside', 'edge:outside']) > 0.45],
  ['the same 45 ms late on a drive is forgiving (< 35% bad)', trial({ type: 'outswinger', lenM: 2.8, lineZ: 0.1, hStumps: 0.42 }, { shot: 'straight', err: 0.045 }), (p) => p(['beaten', 'bowled', 'lbw', 'caught', 'edge:top', 'edge:inside', 'edge:outside']) < 0.35],
  ['perfect scoop to a full straight ball -> over the keeper (|az| > 160)', trial({ type: 'yorker', lenM: 2.6, lineZ: 0.02, hStumps: 0.35 }, { shot: 'scoop' }), (p) => Math.abs(p.az.mean) > 160],
  ['reverse sweep goes to the off side behind square (mean 90..135 deg)', trial({ type: 'offcutter', lenM: 3.6, lineZ: 0.25, hStumps: 0.45 }, { shot: 'reverseSweep' }), (p) => p.az.mean > 90 && p.az.mean < 135],
  ['perfect flick to a full ball at the pads -> mostly hit, to midwicket (az -80..-45)', trial({ type: 'inswinger', lenM: 3.2, lineZ: -0.15, hStumps: 0.45, swing: -0.1 }, { shot: 'flick' }), (p) => p(['hit', 'boundary']) > 0.75 && p.az.mean > -80 && p.az.mean < -45],
  ['the pull to that same full ball mostly fails', trial({ type: 'inswinger', lenM: 3.2, lineZ: -0.15, hStumps: 0.45, swing: -0.1 }, { shot: 'pull' }), (p) => p(['hit', 'boundary']) < 0.4],
];
// The pull key: a flick to a fuller ball, a pull to a short one.
const delAt = (lenM) => buildDelivery({ type: 'outswinger', kph: 138, lenM, lineZ: 0, hStumps: 0.6, swing: 0, seam: 0, length: 'good' }, 0.72);
const keyCases = [[2.5, 'flick'], [5.5, 'flick'], [6.5, 'pull'], [9.0, 'pull']];
// Placing: into the gap, more the better it is timed.
{
  const D = Math.PI / 180;
  const p0 = { x: -7.1, z: 0 };
  const at = (deg, d) => ({ x: p0.x + Math.cos(deg * D) * d, z: p0.z + Math.sin(deg * D) * d });
  const gapDeg = (field) => findGap(p0, 40 * D, 24 * D, field) / D;
  cases.push(['a fielder at cover: the cover drive goes either side of him', () => 0, () => Math.abs(gapDeg([at(40, 14)]) - 40) > 10]);
  cases.push(['cover and extra cover blocked: it goes past one of them', () => 0, () => Math.abs(gapDeg([at(32, 14), at(48, 14)]) - 40) > 14]);
  cases.push(['extra cover and mid-off blocked: it finds the gap toward point', () => 0, () => gapDeg([at(30, 14), at(12, 20)]) > 48]);
  cases.push(['an open field: it goes where it is aimed', () => 0, () => Math.abs(gapDeg([at(-30, 14), at(120, 14)]) - 40) < 3]);
  const placedShare = (err) => {
    let n = 0, placed = 0;
    for (let i = 1; i <= 200; i++) {
      const m = createMatch({ seed: 4000 + i });
      m.startOver();
      const ball = m.nextDelivery({ ...base, ...FULL_OFF });
      const sh = SHOTS.cover;
      const tC = ball.del.contactTime(shotFoot(sh, ball.del));
      const o = m.resolve(ball, { shotKey: 'cover', lofted: false, pressT: tC - sh.swing + err });
      if (o.kind !== 'hit' || o.shot.edge) continue;
      n++;
      placed += o.shot.placeK;
    }
    return placed / Math.max(1, n);
  };
  cases.push(['placing needs timing: perfect steers it, 12 ms off less, 40 ms off not at all', () => 0, () => {
    const [a, b, c] = [placedShare(0), placedShare(0.012), placedShare(0.04)];
    console.log(`       placing ${a.toFixed(2)} / ${b.toFixed(2)} / ${c.toFixed(2)} (max ${K.place})`);
    return a > 0.6 && b > 0.05 && b < a * 0.8 && c < 0.05;
  }]);
}
for (const [len, want] of keyCases) cases.push([`-> key on a ball pitching ${len} m out plays the ${want}`, () => 0, () => shotFor('R', false, delAt(len)) === want]);
cases.push(['S with -> is still the sweep', () => 0, () => shotFor('R', true, delAt(3)) === 'sweep']);
// The straight ball barely moves.
const T = TYPES.straight;
cases.push([`straight ball: swing ${T.swing.join('..')} m, seam ${T.seam.join('..')} m`, () => 0, () => Math.max(...T.swing.map(Math.abs), ...T.seam.map(Math.abs)) <= 0.03]);
// Conditions: the sky swings it, the wind carries it, the pitch bounces it, the outfield slows it.
const avg = (cond, f, keep = () => true) => {
  // Same seeds for every condition; only the balls that pass `keep` count.
  let s = 0, n = 0;
  for (let i = 1; i <= 600; i++) {
    const m = createMatch({ seed: 500 + i, conditions: cond });
    m.startOver();
    const sp = m.nextDelivery().spec;
    if (keep(sp)) { s += f(sp); n++; }
  }
  return s / Math.max(1, n);
};
const calm = { wind: 'calm' };
const swingOf = (sky) => avg({ ...calm, sky }, (sp) => Math.abs(sp.swing));
cases.push([`swing: sunny ${swingOf('sunny').toFixed(2)} < cloudy ${swingOf('cloudy').toFixed(2)} < humid ${swingOf('humid').toFixed(2)} m`, () => 0, () => swingOf('sunny') < swingOf('cloudy') && swingOf('cloudy') < swingOf('humid')]);
const hOf = (pitch) => avg({ ...calm, pitch }, (sp) => sp.hStumps, (sp) => sp.length === 'short' || sp.length === 'bouncer');
cases.push([`short-ball height at the stumps: dusty ${hOf('dusty').toFixed(2)} < standard ${hOf('standard').toFixed(2)} < green ${hOf('green').toFixed(2)} m`, () => 0, () => hOf('dusty') < hOf('standard') && hOf('standard') < hOf('green')]);
const lofted = { az: 0, speed: 19, elev: 0.6 };
const carry = (sel) => { const c = resolveConditions(sel); const sim = simulateBatted({ x: -7.1, y: 0.8, z: 0 }, lofted, { wind: c.wind, roll: c.roll }); return sim.samples.find((q) => !q.air).x + 7.1; };
const [cInto, cCalm, cBack] = [carry({ wind: 'strong', windDir: 'atBatter' }), carry(calm), carry({ wind: 'strong', windDir: 'atBowler' })];
cases.push([`lofted drive carries ${cInto.toFixed(1)} m into the wind, ${cCalm.toFixed(1)} calm, ${cBack.toFixed(1)} with it`, () => 0, () => cInto < cCalm - 1 && cBack > cCalm + 1]);
const cross = (() => { const c = resolveConditions({ wind: 'strong', windDir: 'offSide' }); const sim = simulateBatted({ x: -7.1, y: 0.8, z: 0 }, lofted, { wind: c.wind }); return sim.samples.find((q) => !q.air).z; })();
cases.push([`a cross-wind to off pushes a straight lofted hit ${cross.toFixed(1)} m off side`, () => 0, () => cross > 0.8]);
const roll = (outfield) => { const c = resolveConditions({ ...calm, outfield }); return simulateBatted({ x: -7.1, y: 0.2, z: 0 }, { az: 0.3, speed: 11, elev: 0 }, { roll: c.roll }).samples.at(-1).x; };
cases.push([`a 11 m/s ground shot rolls to x ${roll('slow').toFixed(1)} (slow) < ${roll('standard').toFixed(1)} < ${roll('fast').toFixed(1)} (fast)`, () => 0, () => roll('slow') < roll('standard') && roll('standard') < roll('fast')]);
cases.push(['no conditions = the neutral day (calm, standard)', () => 0, () => { const m = createMatch({ seed: 3 }); return m.cond.wind.x === 0 && m.cond.wind.z === 0 && m.cond.swing === 1 && m.cond.keep === 0.9; }]);

// DRS: ball tracking against the zones, and the umpire.
const lbwBall = (o) => buildDelivery({ type: 'straight', kph: 136, lenM: 5.2, lineZ: -0.02, hStumps: 0.45, swing: 0, seam: 0, length: 'good', ...o }, 0.72);
const plumb = trackLbw(lbwBall({}), 'stance', false);
cases.push([`plumb: pitching ${plumb?.pitching}, impact ${plumb?.impact}, wickets ${plumb?.wickets} -> ${plumb && lbwVerdict(plumb)}`, () => 0, () => plumb && lbwVerdict(plumb) === 'out']);
const leg = trackLbw(lbwBall({ lineZ: -0.05, seam: 0.45 }), 'stance', false);
cases.push([`seamed in from outside leg: pitching ${leg?.pitching} -> ${leg && lbwVerdict(leg)}`, () => 0, () => leg && leg.pitching === 'outsideLeg' && lbwVerdict(leg) === 'notOut']);
const high = trackLbw(lbwBall({ hStumps: 0.76 }), 'stance', false);
cases.push([`clipping the bails: wickets ${high?.wickets} -> ${high && lbwVerdict(high)}`, () => 0, () => high && high.wickets === 'umpiresCall' && lbwVerdict(high) === 'umpiresCall']);
const over = trackLbw(lbwBall({ hStumps: 0.9 }), 'stance', false);
cases.push([`going over: wickets ${over?.wickets}`, () => 0, () => !over || over.wickets === 'missing']);
const perfect = decideLbw({ del: lbwBall({}), foot: 'stance', offered: false, bad: 0, rng: makeRng(1) });
cases.push(['a perfect umpire (bad 0) gives the plumb one', () => 0, () => perfect.given && perfect.truth === 'out']);
const share = (f, n = 2000) => { const r = makeRng(7); let k = 0; for (let i = 0; i < n; i++) if (f(r)) k++; return k / n; };
const plumbGiven = share((r) => decideLbw({ del: lbwBall({}), foot: 'stance', offered: false, bad: 0.25, rng: r }).given);
const legGiven = share((r) => decideLbw({ del: lbwBall({ lineZ: -0.05, seam: 0.36 }), foot: 'stance', offered: false, bad: 0.25, rng: r }).given);
cases.push([`umpire at 25%: plumb given ${(plumbGiven * 100).toFixed(0)}%, just outside leg given ${(legGiven * 100).toFixed(0)}%`, () => 0, () => plumbGiven > 0.85 && plumbGiven < 0.95 && legGiven > 0.05 && legGiven < 0.3]);
const faint = { az: Math.PI - 0.15, edge: 'outside' };
const thick = { az: Math.PI - 0.6, edge: 'outside' };
const keeper = { by: 'keeper', name: 'the keeper' };
const faintMissed = share((r) => !decideEdgeCatch({ shot: faint, fielding: keeper, bad: 0.25, rng: r }).given);
cases.push([`faint edge to the keeper missed ${(faintMissed * 100).toFixed(0)}% of the time; thick edges always given`, () => 0, () => faintMissed > 0.1 && faintMissed < 0.25 && decideEdgeCatch({ shot: thick, fielding: keeper, bad: 0.25, rng: makeRng(2) }).faint === false]);
const phantom = share((r) => !!decidePhantomEdge({ bad: 0.25, rng: r }));
cases.push([`caught behind off nothing: ${(phantom * 100).toFixed(1)}% of balls beaten outside off (none with bad 0)`, () => 0, () => phantom > 0.02 && phantom < 0.12 && decidePhantomEdge({ bad: 0, rng: makeRng(3) }) === null]);
// Reviews: lost when the decision stands, kept on umpire's call, overturned when not out.
{
  const m = createMatch({ seed: 9, umpire: { bad: 0.25, drs: true } });
  const o = { out: 'lbw', umpire: { kind: 'lbw', given: true, truth: 'out' } };
  const a = m.review(o);
  const b = m.review({ ...o, umpire: { ...o.umpire, truth: 'umpiresCall' } });
  const c = m.review({ ...o, umpire: { ...o.umpire, truth: 'notOut' } });
  cases.push([`reviews: upheld costs one (${m.reviewsLeft} left after upheld, umpire's call, overturned)`, () => 0, () => a.lost && b.umpiresCall && !b.lost && c.overturned && m.reviewsLeft === 2 && m.overturn(o).out === null]);
}

// Round the wicket: the same ball from the other side of the stumps.
const both = (spec) => [RELEASE_PT, RELEASE_ROUND].map((rel) => buildDelivery({ type: 'straight', kph: 136, lenM: 5.2, hStumps: 0.42, swing: 0, seam: 0, length: 'good', ...spec }, 0.72, rel));
{
  const [o1, r1] = both({ lineZ: 0.0 });
  cases.push([`at middle: over pitches at z ${o1.bounce.z.toFixed(2)} (angle ${o1.angle.toFixed(2)}), round at ${r1.bounce.z.toFixed(2)} (angle +${r1.angle.toFixed(2)})`, () => 0, () => o1.angle < 0 && r1.angle > 0.6 && r1.bounce.z < o1.bounce.z - 0.2]);
  const [o2, r2] = both({ lineZ: -0.08 });
  const to = trackLbw(o2, 'stance', false), tr2 = trackLbw(r2, 'stance', false);
  cases.push([`at leg stump: over pitches ${to?.pitching}, round pitches ${tr2?.pitching} (so it can't be lbw)`, () => 0, () => to?.pitching === 'inline' && tr2?.pitching === 'outsideLeg']);
  const [, r3] = both({ lineZ: 0.12, lenM: 3.2, length: 'full', hStumps: 0.3 });
  cases.push([`round, full at off stump: angled across ${r3.angle.toFixed(2)} m, still pitching ${trackLbw(r3, 'front', true)?.pitching ?? 'clear of the pad'}`, () => 0, () => r3.angle > 0.8]);
  const share = (() => { let n = 0, k = 0; for (let sd = 1; sd <= 60; sd++) { const m = createMatch({ seed: sd }); m.startOver(); for (let b = 0; b < 6; b++) { n++; if (m.nextDelivery().spec.side === 'round') k++; } } return k / n; })();
  // Swing is kept through the bounce: the line turns there only by the seam, the
  // way the seam moves it (an inswinger never jinks away off the pitch), and the
  // read's marker (pitchZ) is where the ball lands, from either side.
  const kinks = [];
  for (const [swing, seam] of [[-0.25, -0.02], [0.25, 0.02], [-0.25, 0], [0, -0.15], [0.05, -0.4]])
    for (const [i, d] of both({ lineZ: 0.15, swing, seam }).entries()) {
      const e = 0.01, a = d.pos(d.T1 - e), b = d.pos(d.T1), c = d.pos(d.T1 + e);
      const kink = (c.z - b.z) / (b.x - c.x) - (b.z - a.z) / (a.x - b.x);
      const mark = pitchZ(d.spec.lenM, d.spec.lineZ, swing, seam, i ? RELEASE_ROUND : RELEASE_PT);
      kinks.push({ ok: Math.abs(kink - seam / d.spec.lenM) < 0.002 && Math.abs(mark - d.bounce.z) < 1e-9, kink });
    }
  cases.push([`swing kept through the bounce, the turn there only the seam's; the marker on the bounce (${kinks.filter((k) => k.ok).length}/${kinks.length})`, () => 0, () => kinks.every((k) => k.ok)]);
  cases.push([`the AI bowls round the wicket ${(share * 100).toFixed(0)}% of the time`, () => 0, () => share > 0.08 && share < 0.4]);
}
// The AI's innings bats on the code defaults, whatever your calibration says, and leaves it in place.
{
  const runs = () => [1, 2, 3, 4].map((seed) => simulateInnings({ seed, format: 10 }).m.runs).join();
  const before = tuning.overrides();
  tuning.apply({});
  const base = runs();
  tuning.apply({ 'timing.windowScale': 1.97, ...JSON.parse(readFileSync('calibration.json', 'utf8')).params });
  const mine = tuning.current();
  const cal = runs();
  const kept = JSON.stringify(tuning.current()) === JSON.stringify(mine);
  tuning.apply(before);
  cases.push([`AI innings ignores a calibration (${base} vs ${cal}) and leaves it in place`, () => 0, () => base === cal && kept]);
}
// Fielding restrictions.
{
  const outs = (p, mo) => fieldPositions(p, { maxOut: mo }).filter((f) => f.out).length;
  cases.push([`death field: ${outs('death', Infinity)} out unrestricted, ${outs('death', 5)} after the powerplay, ${outs('death', 2)} in it`, () => 0, () => outs('death', 5) === 5 && outs('death', 2) === 2]);
  const ringOk = ['attack', 'balanced', 'death'].every((p) => fieldPositions(p, { maxOut: 5 }).filter((f) => !f.out).length >= 4);
  cases.push(['ring fielders stand inside the circle', () => 0, () => ringOk]);
  const pp = [5, 10, 20].map((format) => { const m = createMatch({ seed: 2, format }); return m.powerplayOvers; });
  const m = createMatch({ seed: 2, format: 20 });
  m.startOver();
  const first = m.maxOut();
  m.balls = 36;
  cases.push([`powerplays: ${pp.join(' / ')} overs of 5 / 10 / 20; in it max ${first} out, after it ${m.maxOut()}`, () => 0, () => pp.join() === '2,3,6' && first === 2 && m.maxOut() === 5 && createMatch({ seed: 1, superOver: true }).powerplayOvers === 0]);
}

let fail = 0;
for (const [name, p, ok] of cases) {
  const pass = ok(p);
  if (!pass) fail++;
  const show = !p.az ? '' : ['hit', 'boundary', 'caught', 'bowled', 'lbw', 'beaten', 'edge:outside', 'edge:inside', 'edge:top', 'safe'].map((k) => `${k} ${(p(k) * 100).toFixed(0)}`).filter((s) => !s.endsWith(' 0')).join(', ');
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}\n       ${show}${p.az && p.az.sd ? ` | az ${p.az.mean.toFixed(0)} deg sd ${p.az.sd.toFixed(1)}` : ''}`);
}
console.log(fail ? `${fail} rule check(s) failed` : 'all rule checks passed');
process.exit(fail ? 1 : 0);
